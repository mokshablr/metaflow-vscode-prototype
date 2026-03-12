#!/usr/bin/env python3
"""Extract DAG structure from a Metaflow flow file using FlowGraph."""

import sys
import os
import json
import importlib.util


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: get_dag.py <flow_file>"}))
        sys.exit(1)

    flow_file = os.path.abspath(sys.argv[1])
    if not os.path.isfile(flow_file):
        print(json.dumps({"error": f"File not found: {flow_file}"}))
        sys.exit(1)

    # Inject flow's directory so local imports resolve
    flow_dir = os.path.dirname(flow_file)
    sys.path.insert(0, flow_dir)

    try:
        from metaflow.graph import FlowGraph
        from metaflow import FlowSpec
    except ImportError:
        print(json.dumps({"error": "Metaflow is not installed in the current Python environment."}))
        sys.exit(1)

    try:
        # Load the module dynamically
        # Register in sys.modules so inspect.getsourcefile() can resolve the source
        module_name = os.path.splitext(os.path.basename(flow_file))[0]
        spec = importlib.util.spec_from_file_location(module_name, flow_file)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)

        # Find FlowSpec subclass
        flow_cls = None
        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            if (
                isinstance(attr, type)
                and issubclass(attr, FlowSpec)
                and attr is not FlowSpec
            ):
                flow_cls = attr
                break

        if flow_cls is None:
            print(json.dumps({"error": "No FlowSpec subclass found in this file."}))
            sys.exit(1)

        # Build graph
        graph = FlowGraph(flow_cls)

        nodes = []
        edges = []

        for node in graph.nodes.values():
            # Determine node type
            if node.name == "start":
                node_type = "start"
            elif node.name == "end":
                node_type = "end"
            elif node.type == "join":
                node_type = "join"
            elif node.type == "foreach":
                node_type = "foreach"
            elif len(node.out_funcs) > 1:
                node_type = "split"
            else:
                node_type = "linear"

            # func_lineno is set by DAGNode to the actual def line
            nodes.append({
                "id": node.name,
                "type": node_type,
                "line": node.func_lineno,
            })

            # Extract edges
            for target in node.out_funcs:
                edges.append({"from": node.name, "to": target})

        print(json.dumps({"nodes": nodes, "edges": edges}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
