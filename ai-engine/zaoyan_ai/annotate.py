"""标注渲染。

原实现的问题：

1. 用 ``cv2.putText`` 的 Hershey 字体，**只能画 ASCII**。项目里
   ``target_label`` 可能是中文（``演示托盘``），落到视频上全是 ``????``。
2. 把 ROI 之外的区域**整片涂黑**（``out[:ay,:]=0``），既不美观，
   也让复核人员看不到出餐口周边的关键上下文。
3. HUD 是硬编码像素坐标，换分辨率就错位。

现在：Pillow 渲染 TrueType 中文字体（自动探测 Windows / Linux / macOS 系统字体），
ROI 外做**压暗**而不是涂黑，HUD 与图例按画面尺寸等比缩放。
Pillow 不可用时退化为 Hershey 字体并跳过非 ASCII 字符，保证不崩。
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

# 主题色（BGR）
COLOR_ACCENT = (150, 200, 120)
COLOR_ACCENT_SOFT = (196, 226, 178)
COLOR_TEXT = (246, 249, 245)
COLOR_TEXT_DIM = (196, 214, 201)
COLOR_PANEL = (48, 58, 34)
COLOR_DANGER = (120, 170, 235)
COLOR_OK = (140, 205, 160)
COLOR_WARN = (150, 196, 235)
COLOR_CROSS = (90, 190, 250)

_FONT_CANDIDATES = (
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\Deng.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
)


@lru_cache(maxsize=8)
def _load_font(size: int, bold: bool = False):
    """探测并加载可用的 CJK TrueType 字体；失败返回 None。"""
    try:
        from PIL import ImageFont
    except Exception:
        return None
    order = _FONT_CANDIDATES
    if bold:
        # 粗体优先，但找不到时退回常规体而不是放弃。
        order = tuple(p for p in _FONT_CANDIDATES if "bd" in p or "simhei" in p) + tuple(
            p for p in _FONT_CANDIDATES if not ("bd" in p or "simhei" in p)
        )
    for path in order:
        if not Path(path).is_file():
            continue
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return None


def cjk_available() -> bool:
    return _load_font(20) is not None


class _TextRenderer:
    """优先 Pillow 渲染中文；不可用时退化到 Hershey 的 ASCII 子集。"""

    def __init__(self) -> None:
        try:
            from PIL import Image, ImageDraw  # noqa: F401

            self._pil = True
        except Exception:
            self._pil = False

    @property
    def cjk(self) -> bool:
        return self._pil and _load_font(20) is not None

    def measure(self, text: str, size: int, bold: bool = False) -> tuple[int, int]:
        if not text:
            return 0, size
        font = _load_font(size, bold) if self._pil else None
        if font is not None:
            try:
                left, top, right, bottom = font.getbbox(text)
                return int(right - left), int(bottom - top)
            except Exception:
                pass
        scale = size / 32.0
        (width, height), _ = cv2.getTextSize(_ascii_only(text), cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
        return int(width), int(height)

    def draw(
        self,
        frame: np.ndarray,
        text: str,
        origin: tuple[int, int],
        size: int,
        color: tuple[int, int, int],
        bold: bool = False,
        alpha: float = 1.0,
    ) -> np.ndarray:
        """在 frame 上绘制文本，origin 为左上角。返回修改后的 frame。"""
        if not text:
            return frame
        font = _load_font(size, bold) if self._pil else None
        if font is not None:
            try:
                from PIL import Image, ImageDraw

                # 用紧贴文本的 RGBA 图层，避免整帧 PNG 往返带来的巨大开销。
                left, top, right, bottom = font.getbbox(text)
                pad = 3
                width = max(1, int(right - left) + pad * 2)
                height = max(1, int(bottom - top) + pad * 2)
                layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                draw = ImageDraw.Draw(layer)
                draw.text((pad - left, pad - top), text, font=font, fill=(color[2], color[1], color[0], 255))
                patch = np.array(layer, dtype=np.uint8)
                if alpha < 1.0:
                    patch[:, :, 3] = (patch[:, :, 3].astype(np.float32) * alpha).astype(np.uint8)
                return _alpha_paste(frame, patch, origin[0], origin[1])
            except Exception:
                pass
        # 退化路径：Hershey 只支持 ASCII，非 ASCII 字符会被丢弃而不是画成方块。
        scale = size / 32.0
        cv2.putText(
            frame,
            _ascii_only(text),
            (origin[0], origin[1] + size),
            cv2.FONT_HERSHEY_SIMPLEX,
            scale,
            color,
            max(1, int(round(scale * 2))),
            cv2.LINE_AA,
        )
        return frame


def _ascii_only(text: str) -> str:
    return "".join(ch if ord(ch) < 128 else "?" for ch in text)


def _alpha_paste(frame: np.ndarray, patch: np.ndarray, x: int, y: int) -> np.ndarray:
    """把 RGBA patch 以 alpha 混合方式贴到 BGR frame 上，自动裁剪越界部分。"""
    height, width = frame.shape[:2]
    ph, pw = patch.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(width, x + pw), min(height, y + ph)
    if x0 >= x1 or y0 >= y1:
        return frame
    sx0, sy0 = x0 - x, y0 - y
    sub = patch[sy0 : sy0 + (y1 - y0), sx0 : sx0 + (x1 - x0)]
    alpha = sub[:, :, 3:4].astype(np.float32) / 255.0
    rgb = sub[:, :, :3].astype(np.float32)
    region = frame[y0:y1, x0:x1].astype(np.float32)
    blended = rgb * alpha + region * (1.0 - alpha)
    frame[y0:y1, x0:x1] = blended.astype(np.uint8)
    return frame


def _rounded_rect(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int, color, radius: int, alpha: float = 1.0) -> None:
    """画圆角矩形；alpha<1 时做半透明叠加。"""
    if x2 <= x1 or y2 <= y1:
        return
    radius = int(max(0, min(radius, (x2 - x1) // 2, (y2 - y1) // 2)))
    if alpha >= 1.0:
        cv2.rectangle(frame, (x1 + radius, y1), (x2 - radius, y2), color, -1, cv2.LINE_AA)
        cv2.rectangle(frame, (x1, y1 + radius), (x2, y2 - radius), color, -1, cv2.LINE_AA)
        for cx, cy in (
            (x1 + radius, y1 + radius),
            (x2 - radius, y1 + radius),
            (x1 + radius, y2 - radius),
            (x2 - radius, y2 - radius),
        ):
            cv2.circle(frame, (cx, cy), radius, color, -1, cv2.LINE_AA)
        return
    overlay = frame.copy()
    _rounded_rect(overlay, x1, y1, x2, y2, color, radius, 1.0)
    cv2.addWeighted(overlay, alpha, frame, 1.0 - alpha, 0, dst=frame)


def _corner_brackets(frame: np.ndarray, box, color, length: int, thickness: int) -> None:
    x1, y1, x2, y2 = box
    length = int(max(6, min(length, (x2 - x1) // 2, (y2 - y1) // 2)))
    for (cx, cy, dx, dy) in (
        (x1, y1, 1, 1),
        (x2, y1, -1, 1),
        (x1, y2, 1, -1),
        (x2, y2, -1, -1),
    ):
        cv2.line(frame, (cx, cy), (cx + dx * length, cy), color, thickness, cv2.LINE_AA)
        cv2.line(frame, (cx, cy), (cx, cy + dy * length), color, thickness, cv2.LINE_AA)


_RENDERER = _TextRenderer()


def draw_annotations(frame: np.ndarray, detections: list, line, count: int) -> np.ndarray:
    """生成带标注的输出帧。不修改入参 frame。"""
    out = frame.copy()
    height, width = out.shape[:2]
    rules = line.rules
    unit = max(1.0, min(width, height) / 720.0)

    ax = int(round(rules["roiX1"] * width))
    ay = int(round(rules["roiY1"] * height))
    bx = int(round(rules["roiX2"] * width))
    by = int(round(rules["roiY2"] * height))

    # ROI 之外压暗而不是涂黑：既突出计数区域，又保留出餐口上下文。
    out = _dim_outside_roi(out, ax, ay, bx, by)

    # ROI 边框：细线 + 四角标记。
    cv2.rectangle(out, (ax, ay), (bx, by), (150, 170, 150), max(1, int(unit)), cv2.LINE_AA)
    _corner_brackets(out, (ax, ay, bx, by), COLOR_ACCENT_SOFT, int(26 * unit), max(2, int(2 * unit)))
    # ROI 恰好覆盖整帧时没有“区域”可言，标签也会与 HUD 打架，因此跳过。
    if (ax, ay, bx, by) != (0, 0, width, height):
        _draw_roi_label(out, (ax, ay), unit)

    # 计数线：底衬 + 主色 + 方向箭头。
    x1 = int(round(line.points[0] * width))
    y1 = int(round(line.points[1] * height))
    x2 = int(round(line.points[2] * width))
    y2 = int(round(line.points[3] * height))
    cv2.line(out, (x1, y1), (x2, y2), (40, 60, 45), max(3, int(6 * unit)), cv2.LINE_AA)
    cv2.line(out, (x1, y1), (x2, y2), COLOR_ACCENT, max(2, int(2.4 * unit)), cv2.LINE_AA)
    _draw_direction_arrows(out, (x1, y1), (x2, y2), line, unit)

    # 目标框
    for detection in detections:
        a, b, c, e = detection.bbox
        colour = COLOR_ACCENT
        reasons = set(getattr(detection, "reasons", ()) or ())
        if "LOW_CONFIDENCE" in reasons:
            colour = COLOR_WARN
        if "OVERLAP" in reasons or "NESTED_TARGET" in reasons:
            colour = COLOR_DANGER
        _corner_brackets(out, (a, b, c, e), colour, int(16 * unit), max(2, int(2 * unit)))
        _draw_label_chip(out, (a, b), f"#{detection.track_id} {detection.label}", colour, unit, detection.confidence)

    _draw_hud(out, count, unit)
    return out


def _dim_outside_roi(frame: np.ndarray, ax: int, ay: int, bx: int, by: int) -> np.ndarray:
    """ROI 之外置黑，ROI 内保持原始像素。

    保留 ROI 内像素是刻意的：复核人员需要看清原始画面，
    而 ROI 外没有计数的意义，置黑可以让人一眼看出有效统计范围。

    实现用切片赋值而不是构造全幅压暗图：ROI 覆盖整帧时零拷贝，
    大分辨率下也不会白白多分配一份与帧等大的缓冲区。
    """
    height, width = frame.shape[:2]
    ax, ay = max(0, min(ax, width)), max(0, min(ay, height))
    bx, by = max(0, min(bx, width)), max(0, min(by, height))
    if ax == 0 and ay == 0 and bx >= width and by >= height:
        return frame
    result = np.zeros_like(frame)
    if bx > ax and by > ay:
        result[ay:by, ax:bx] = frame[ay:by, ax:bx]
    return result


def _draw_roi_label(frame: np.ndarray, origin: tuple[int, int], unit: float) -> None:
    text = "识别区域 ROI"
    size = int(13 * unit)
    width, height = _RENDERER.measure(text, size, bold=False)
    pad_x, pad_y = int(8 * unit), int(5 * unit)
    x = origin[0] + int(8 * unit)
    y = origin[1] + int(8 * unit)
    _rounded_rect(
        frame,
        x,
        y,
        x + width + pad_x * 2,
        y + height + pad_y * 2,
        (36, 48, 38),
        int(7 * unit),
        alpha=0.72,
    )
    _RENDERER.draw(frame, text, (x + pad_x, y + pad_y), size, COLOR_TEXT_DIM)


def _draw_direction_arrows(frame: np.ndarray, p1, p2, line, unit: float) -> None:
    """沿计数线画方向箭头，指示“计为有效出餐”的法线方向。"""
    vx, vy = p2[0] - p1[0], p2[1] - p1[1]
    length = float(np.hypot(vx, vy))
    if length < 1e-6:
        return
    # 单位法线，按方向语义指向有效穿越的一侧。
    nx, ny = -vy / length, vx / length
    sign = 1.0 if line.direction == "positive" else -1.0
    nx, ny = nx * sign, ny * sign
    arrow = int(26 * unit)
    for fraction in (0.25, 0.5, 0.75):
        cx = int(p1[0] + (p2[0] - p1[0]) * fraction)
        cy = int(p1[1] + (p2[1] - p1[1]) * fraction)
        tip = (int(cx + nx * arrow), int(cy + ny * arrow))
        cv2.arrowedLine(frame, (cx, cy), tip, COLOR_ACCENT_SOFT, max(1, int(1.6 * unit)), cv2.LINE_AA, tipLength=0.42)


def _draw_label_chip(
    frame: np.ndarray,
    anchor: tuple[int, int],
    text: str,
    colour: tuple[int, int, int],
    unit: float,
    confidence: float | None = None,
) -> None:
    label = text if confidence is None else f"{text}  {confidence * 100:.0f}%"
    size = int(13 * unit)
    width, height = _RENDERER.measure(label, size)
    pad_x, pad_y = int(7 * unit), int(4 * unit)
    x = anchor[0]
    # 贴近画面上边缘时把标签放到框内侧，避免被裁掉。
    y = anchor[1] - (height + pad_y * 2) - int(3 * unit)
    if y < 0:
        y = anchor[1] + int(3 * unit)
    box_x2 = min(frame.shape[1], x + width + pad_x * 2)
    _rounded_rect(frame, x, y, box_x2, y + height + pad_y * 2, colour, int(6 * unit), alpha=0.90)
    _RENDERER.draw(
        frame,
        label,
        (x + pad_x, y + pad_y),
        size,
        (28, 40, 30),
        bold=True,
    )


def _draw_hud(frame: np.ndarray, count: int, unit: float) -> None:
    """左上角统计面板。"""
    title = "有效越线"
    value = str(int(count))
    unit_text = "次"

    size_label = int(12 * unit)
    size_value = int(30 * unit)
    size_unit = int(12 * unit)
    w_label, h_label = _RENDERER.measure(title, size_label)
    w_value, h_value = _RENDERER.measure(value, size_value, bold=True)
    w_unit, h_unit = _RENDERER.measure(unit_text, size_unit)

    pad = int(14 * unit)
    gap = int(4 * unit)
    inner_w = max(w_label, w_value + gap + w_unit)
    panel_w = inner_w + pad * 2
    panel_h = h_label + h_value + h_unit + pad * 2 + gap * 2
    x, y = int(16 * unit), int(16 * unit)

    _rounded_rect(frame, x, y, x + panel_w, y + panel_h, COLOR_PANEL, int(10 * unit), alpha=0.84)
    # 左侧强调色条
    _rounded_rect(frame, x, y, x + int(4 * unit), y + panel_h, COLOR_ACCENT, int(2 * unit), alpha=1.0)

    cursor_y = y + pad
    _RENDERER.draw(frame, title, (x + pad, cursor_y), size_label, COLOR_TEXT_DIM)
    cursor_y += h_label + gap
    _RENDERER.draw(frame, value, (x + pad, cursor_y), size_value, COLOR_TEXT, bold=True)
    _RENDERER.draw(frame, unit_text, (x + pad + w_value + gap, cursor_y + h_value - h_unit), size_unit, COLOR_TEXT_DIM)
    cursor_y += h_value + gap
    _RENDERER.draw(frame, "ZAOYAN AI · SIMULATION", (x + pad, cursor_y), int(9 * unit), (140, 160, 148))
