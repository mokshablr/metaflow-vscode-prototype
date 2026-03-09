from metaflow import Metaflow
import json, sys

try:
    data = {}
    for flow in Metaflow():
        data[flow.id] = [run.id for run in flow]
    print(json.dumps(data))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
