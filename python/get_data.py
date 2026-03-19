from metaflow import Metaflow, Run, Step, Task
import json, sys, os, importlib.util

REPR_LIMIT = 120


def load_flow_module(flow_file):
    """Load a Python file and return the FlowSpec subclass found in it.

    Returns (flow_cls, module_name) or raises RuntimeError if no FlowSpec is found.
    Side-effect: inserts flow_file's directory into sys.path if not already present.
    """
    from metaflow import FlowSpec
    flow_dir = os.path.dirname(flow_file)
    module_name = os.path.splitext(os.path.basename(flow_file))[0]
    if flow_dir not in sys.path:
        sys.path.insert(0, flow_dir)
    spec_obj = importlib.util.spec_from_file_location(module_name, flow_file)
    module = importlib.util.module_from_spec(spec_obj)
    sys.modules[module_name] = module
    spec_obj.loader.exec_module(module)
    for attr_name in dir(module):
        attr = getattr(module, attr_name)
        if isinstance(attr, type) and issubclass(attr, FlowSpec) and attr is not FlowSpec:
            return attr, module_name
    raise RuntimeError("No FlowSpec subclass found")


def task_status(task):
    try:
        if task.successful:
            return 'done'
        # _exception artifact is written on failure even if _task_ok is not flushed
        if task.exception is not None:
            return 'failed'
        if task.finished:
            return 'failed'
        return 'running'
    except Exception:
        return 'unknown'


def step_status(step):
    try:
        result = 'unknown'
        for t in step:
            s = task_status(t)
            if s == 'failed':
                return 'failed'  # short-circuit; failure dominates all other statuses
            if s == 'running':
                result = 'running'
            elif s == 'done' and result == 'unknown':
                result = 'done'
        return result
    except Exception:
        return 'unknown'


def _truncated_repr(data):
    r = repr(data)
    return r if len(r) <= REPR_LIMIT else r[:REPR_LIMIT] + '…'


def artifact_info(data):
    type_name = type(data).__name__
    raw = _truncated_repr(data)
    try:
        if hasattr(data, 'shape'):
            cols = f", columns={list(data.columns)}" if hasattr(data, 'columns') else ''
            preview = f"shape={data.shape}{cols}"
        elif isinstance(data, dict) and len(data) > 3:
            keys = list(data.keys())[:3]
            preview = f"{len(data)} keys — {', '.join(repr(k) for k in keys)}, …"
        elif isinstance(data, (list, tuple)) and len(data) > 3:
            preview = f"{len(data)} items — {', '.join(repr(x) for x in data[:3])}, …"
        else:
            preview = raw
    except Exception:
        preview = f"<{type_name}>"
    return {'type': type_name, 'preview': preview, 'raw': raw}


try:
    command = sys.argv[1]

    if command == 'flows':
        status_filter = sys.argv[2] if len(sys.argv) > 2 else 'all'
        data = {}
        for flow in Metaflow():
            run_ids = []
            for run in flow:
                try:
                    if status_filter == 'successful' and not run.successful:
                        continue
                    if status_filter == 'failed' and run.successful:
                        continue
                except Exception:
                    if status_filter == 'successful':
                        continue
                run_ids.append(run.id)
            data[flow.id] = run_ids
        print(json.dumps(data))

    elif command == 'steps':
        run = Run(sys.argv[2])
        steps = [{'name': s.id, 'status': step_status(s)} for s in run]
        print(json.dumps(list(reversed(steps))))

    elif command == 'tasks':
        step = Step(sys.argv[2])
        result = []
        for t in step:
            duration = None
            try:
                if t.finished_at and t.created_at:
                    duration = round((t.finished_at - t.created_at).total_seconds(), 1)
            except Exception:
                pass
            result.append({'id': t.id, 'status': task_status(t), 'duration': duration})
        print(json.dumps(result))

    elif command == 'artifacts':
        task = Task(sys.argv[2])
        result = {}
        for artifact in task:
            try:
                result[artifact.id] = artifact_info(artifact.data)
            except Exception as e:
                result[artifact.id] = {'type': 'error', 'preview': f'<error: {e}>', 'raw': ''}
        print(json.dumps(result))

    elif command == 'gen_debug_wrapper':
        # Generate a standalone Python script that loads artifacts from the input task
        # and calls the step function directly, bypassing Metaflow's `step` CLI
        # (which requires orchestrator-managed state like _graph_info that is not
        # propagated to intermediate task datastores).
        #
        # argv[2] = flow_name/run_id/step_name/task_id
        # argv[3] = absolute path to the flow file
        import tempfile
        from metaflow.graph import FlowGraph

        parts = sys.argv[2].split('/')
        flow_name, run_id, step_name, task_id = parts[0], parts[1], parts[2], parts[3]
        flow_file = os.path.abspath(sys.argv[3])
        flow_dir = os.path.dirname(flow_file)

        flow_cls, module_name = load_flow_module(flow_file)

        # Find input task pathspecs using the flow graph
        input_task_pathspecs = []
        graph = FlowGraph(flow_cls)
        node = graph.nodes.get(step_name)
        if node and node.in_funcs:
            for pred_name in node.in_funcs:
                direct_pathspec = f'{flow_name}/{run_id}/{pred_name}/{task_id}'
                try:
                    # Fast path: try direct task lookup (works for linear and foreach-split steps)
                    Task(direct_pathspec)
                    input_task_pathspecs.append(direct_pathspec)
                except Exception:
                    # Fallback: enumerate all predecessor tasks (foreach-join and other cases)
                    for t in Step(f'{flow_name}/{run_id}/{pred_name}'):
                        input_task_pathspecs.append(
                            f'{flow_name}/{run_id}/{pred_name}/{t.id}'
                        )

        # Build the artifact-loading block
        load_lines = []
        for i, tp in enumerate(input_task_pathspecs):
            load_lines += [
                f"_t{i} = _MFTask('{tp}')",
                f"for _a in _t{i}:",
                f"    if not _a.id.startswith('_'):",
                f"        try:",
                f"            _arts[_a.id] = _a.data",
                f"        except Exception:",
                f"            pass",
            ]

        flow_cls_name = flow_cls.__name__
        flow_file_repr = repr(flow_file)
        flow_dir_repr = repr(flow_dir)
        module_name_repr = repr(module_name)

        wrapper_lines = [
            "# Metaflow Debug Wrapper — auto-generated by metaflow-vscode",
            f"# Debugging: {flow_name}/{run_id}/{step_name}/{task_id}",
            "#",
            "# Set your breakpoints in the original flow file.",
            "# This script loads the step's input artifacts and calls the step directly,",
            "# bypassing Metaflow's internal step CLI to avoid _graph_info lookup issues.",
            "import sys as _sys",
            f"_sys.path.insert(0, {flow_dir_repr})",
            "from metaflow import Task as _MFTask",
            "import importlib.util as _ilu",
            "",
            "# ── Load artifacts from predecessor task(s) ──────────────────────────────",
            "_arts = {}",
        ] + load_lines + [
            "",
            "# ── Import the flow class ───────────────────────────────────────────────",
            f"_spec = _ilu.spec_from_file_location({module_name_repr}, {flow_file_repr})",
            "_mod = _ilu.module_from_spec(_spec)",
            f"_sys.modules[{module_name_repr}] = _mod",
            "_spec.loader.exec_module(_mod)",
            f"_{flow_cls_name} = getattr(_mod, {repr(flow_cls_name)})",
            "",
            "# ── Create a minimal flow instance with the predecessor's artifacts ─────",
            f"_flow = _{flow_cls_name}.__new__(_{flow_cls_name})",
            "# Provide safe defaults for common Metaflow private attrs",
            "_flow.__dict__.update({'_datastore': None, '_graph': None,",
            "                       '_graph_info': {}, '_foreach_stack': [],",
            "                       '_success': False, '_task_ok': True})",
            "for _k, _v in _arts.items():",
            "    setattr(_flow, _k, _v)",
            "# Stub self.next() so the step's routing call is a no-op",
            "_flow.next = lambda *_a, **_kw: None",
            "",
            f"# ── Execute step '{step_name}' ─────────────────────────────────────────",
            f"# (Set your breakpoints in {flow_file})",
            f"_{flow_cls_name}.{step_name}(_flow)",
        ]

        wrapper_content = '\n'.join(wrapper_lines) + '\n'

        fd, tmp_path = tempfile.mkstemp(
            prefix=f'mf_debug_{flow_name}_{step_name}_',
            suffix='.py'
        )
        with os.fdopen(fd, 'w') as f:
            f.write(wrapper_content)

        print(json.dumps({'wrapper_path': tmp_path}))

    else:
        print(json.dumps({"error": f"unknown command: {command}"}))
        sys.exit(1)

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
