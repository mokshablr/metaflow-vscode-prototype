import sys, os, shutil, json

try:
    flow_name = sys.argv[1]
    run_id    = sys.argv[2]
    base = os.path.join(".metaflow", flow_name, run_id)
    if not os.path.exists(base):
        raise Exception(f"Run not found: {flow_name}/{run_id}")
    shutil.rmtree(base)
    print(json.dumps({"ok": True}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
