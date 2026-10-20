"""只读运行时探测。不安装依赖、不下载权重、不写任何文件。

输出会被 Spring Boot 直接透传给 ``/api/system/capabilities``，
因此这里只报告**可验证的事实**，不做能力承诺：
``yoloConfigured`` 为真仅表示依赖与权重文件存在，
不代表模型类别、精度或真实场景适用性已经验证。
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path


def main() -> None:
    weights = sys.argv[1] if len(sys.argv) > 1 else ''
    result = {
        'python': sys.version.split()[0],
        'opencv': False,
        'ffmpeg': bool(shutil.which('ffmpeg')),
        'ultralytics': bool(importlib.util.find_spec('ultralytics')),
        'weightsPresent': bool(weights and Path(weights).is_file()),
        # Pillow 决定标注视频能否渲染中文标签；
        # 缺失时不会崩，但中文会被降级成 '?'。
        'pillow': bool(importlib.util.find_spec('PIL')),
        'cjkFont': False,
        'tracker': 'kalman+hungarian',
        'segmenter': 'adaptive-color',
    }

    try:
        import cv2
        import numpy as np

        ok, encoded = cv2.imencode('.jpg', np.zeros((16, 16, 3), dtype=np.uint8))
        result['opencv'] = bool(ok and cv2.imdecode(encoded, cv2.IMREAD_COLOR) is not None)
        # 打印实际 OpenCV 版本，便于对照"本机到底跑的哪一版"。
        result['opencvVersion'] = str(cv2.__version__)
    except Exception:
        pass

    if result['pillow']:
        try:
            from zaoyan_ai.annotate import cjk_available

            result['cjkFont'] = bool(cjk_available())
        except Exception:
            result['cjkFont'] = False

    result['demoReady'] = bool(result['opencv'] and result['ffmpeg'])
    result['yoloConfigured'] = bool(
        result['demoReady'] and result['ultralytics'] and result['weightsPresent']
    )

    notes = ['YOLO 已配置仅表示依赖与权重文件存在，不表示模型类别、精度或真实场景适用性已验证']
    if result['demoReady'] and not result['cjkFont']:
        notes.append('未找到可用的中文字体，标注视频中的中文标签会降级为 ASCII；安装 Pillow 与系统中文字体可恢复')
    result['notice'] = '；'.join(notes)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
