import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from boran import graph

raw = graph.fetch_raw()
data = graph.build(raw)
graph.save(data)
print(f"nodes {len(data['nodes'])}, edges {len(data['edges'])}, buildings {len(data['buildings'])}, stops {len(data['stops'])}, warm {len(data['warm'])}")
print("saved", graph.data_path())
