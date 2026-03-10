from metaflow import Metaflow, Run, Step, Task
import json, sys

REPR_LIMIT = 120


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
        print(json.dumps([{'id': t.id, 'status': task_status(t)} for t in step]))

    elif command == 'artifacts':
        task = Task(sys.argv[2])
        result = {}
        for artifact in task:
            try:
                result[artifact.id] = artifact_info(artifact.data)
            except Exception as e:
                result[artifact.id] = {'type': 'error', 'preview': f'<error: {e}>', 'raw': ''}
        print(json.dumps(result))

    else:
        print(json.dumps({"error": f"unknown command: {command}"}))
        sys.exit(1)

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
