"""Inspect a trusted LOCAL model and its class mapping. Does not train or download models."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from zaoyan_ai.rules import load_rules


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--weights',required=True,help='Trusted local model only; model files may execute code while loading')
    p.add_argument('--rules',help='Optional saved counting rules JSON')
    p.add_argument('--output',help='Optional JSON inspection report')
    args=p.parse_args();path=Path(args.weights).expanduser().resolve()
    if not path.is_file():p.error('model must already exist locally')
    rules=load_rules(args.rules)
    from ultralytics import YOLO
    model=YOLO(str(path));names=model.names
    if isinstance(names,list):names=dict(enumerate(names))
    available={str(v).lower() for v in names.values()}
    hasher=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(65536),b''):hasher.update(block)
    digest=hasher.hexdigest()
    matched=sorted(available&set(rules['targetLabels']));empty=sorted(available&set(rules['emptyLabels']))
    result={'weights_filename':path.name,'sha256':digest,'classes':names,'matched_target_labels':matched,
            'matched_empty_labels':empty,'mapping_ready':bool(matched),
            'warning':'Class overlap is not demonstrated detection accuracy. Unknown contents still require review.'}
    text=json.dumps(result,ensure_ascii=False,indent=2);print(text)
    if args.output:
        out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(text,encoding='utf-8')
    if not matched:raise SystemExit(2)

if __name__=='__main__':main()
