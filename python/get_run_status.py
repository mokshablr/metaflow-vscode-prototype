#!/usr/bin/env python3
"""Query run/step statuses via Metaflow client API.

Ordering and pending-step detection are handled by the TypeScript caller,
which caches the DAG topology once at monitor start using get_dag.py.
"""

import sys
import json


def task_status(task):
    try:
        if task.successful:
            return 'done'
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
                return 'failed'
            if s == 'running':
                result = 'running'
            elif s == 'done' and result == 'unknown':
                result = 'done'
        return result
    except Exception:
        return 'unknown'


try:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: get_run_status.py <flow_name> <run_id>"}))
        sys.exit(1)

    flow_name = sys.argv[1]
    run_id = sys.argv[2]

    from metaflow import Run

    run = Run(f"{flow_name}/{run_id}")

    # Return steps in execution order (Metaflow iterates in reverse; reversed() fixes it)
    steps = [{"name": s.id, "status": step_status(s)} for s in reversed(list(run))]

    print(json.dumps({
        "flow": flow_name,
        "run_id": run_id,
        "finished": bool(run.finished),
        "successful": run.successful if run.finished else None,
        "steps": steps,
    }))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
