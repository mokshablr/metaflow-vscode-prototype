from metaflow import Metaflow, Run, Step, Task
import json, sys

REPR_LIMIT = 120

try:
    command = sys.argv[1]

    if command == 'flows':
        data = {flow.id: [run.id for run in flow] for flow in Metaflow()}
        print(json.dumps(data))

    elif command == 'steps':
        run = Run(sys.argv[2])
        print(json.dumps(list(reversed([step.id for step in run]))))

    elif command == 'tasks':
        step = Step(sys.argv[2])
        print(json.dumps([task.id for task in step]))

    elif command == 'artifacts':
        task = Task(sys.argv[2])
        result = {}
        for artifact in task:
            try:
                r = repr(artifact.data)
                result[artifact.id] = r if len(r) <= REPR_LIMIT else r[:REPR_LIMIT] + '\u2026'
            except Exception as e:
                result[artifact.id] = f'<error: {e}>'
        print(json.dumps(result))

    else:
        print(json.dumps({"error": f"unknown command: {command}"}))
        sys.exit(1)

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
