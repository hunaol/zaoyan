"""Read-only runtime probe. Does not install dependencies or load weights."""
from __future__ import annotations
import importlib.util
import json
import shutil
import sys
from pathlib import Path


def main() -> None:
    weights = sys.argv[1] if len(sys.argv)>1 else ''
    result = {'python': sys.version.split()[0], 'opencv': False, 'ffmpeg': bool(shutil.which('ffmpeg')),
              'ultralytics': bool(importlib.util.find_spec('ultralytics')), 'weightsPresent': bool(weights and Path(weights).is_file())}
    try:
        import cv2
        import numpy as np
        ok, encoded = cv2.imencode('.jpg', np.zeros((16,16,3), dtype=np.uint8))
        result['opencv'] = bool(ok and cv2.imdecode(encoded,cv2.IMREAD_COLOR) is not None)
    except Exception:
        pass
    result['demoReady'] = result['opencv'] and result['ffmpeg']
    result['yoloConfigured'] = result['demoReady'] and result['ultralytics'] and result['weightsPresent']
    result['notice'] = 'YOLO 已配置仅表示依赖与权重文件存在，不表示模型类别、精度或真实场景适用性已验证'
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':
    main()
