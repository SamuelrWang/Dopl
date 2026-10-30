import type { ReactNode } from "react";
import { u } from "../_design/components";
import styles from "./design-playground.module.css";

/**
 * Hand-traced from 10x crops of the reference. Each SVG sits at the crop's own origin and its
 * coordinates are that crop's pixels, so stroke weights and shapes read straight off the image.
 */
function Svg({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: ReactNode }) {
  return (
    <svg className={styles.svg} style={{ left: u(x), top: u(y), width: u(w), height: u(h) }} viewBox={`0 0 ${w} ${h}`} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function DropZoneOutline() {
  const dash = { stroke: "#cccccc", strokeWidth: 1.25, strokeLinecap: "butt" } as const;
  return (
    <svg className={styles.svg} style={{ left: u(160), top: u(318), width: u(463), height: u(187) }} viewBox="160 318 463 187" fill="none" aria-hidden="true">
      <path {...dash} d="M172 321.3H610.6M172 502H610.6" strokeDasharray="5.7 6.03" />
      <path {...dash} d="M163 330V492M620 330V492" strokeDasharray="5.6 5.69" />
      <path {...dash} d="M163.5 327.5A11 11 0 0 1 168 322.3M619.5 327.5A11 11 0 0 0 615 322.3M163.5 496A11 11 0 0 0 168 501M619.5 496A11 11 0 0 1 615 501" />
    </svg>
  );
}

export function UploadCloud() {
  return (
    <Svg x={365} y={350} w={50} h={45}>
      <g stroke="#0a0a0a" strokeWidth={2}>
        <path d="M17.2 28C15 26 14 23.6 14.5 20.6C15.2 15 19.5 11 24 11.2C26.6 11.2 28.6 12.4 29.6 14.2C30.4 15.6 31.6 16.6 33.4 17C36.8 17.8 39.4 20.2 39.3 23.8C39.3 26 38 28 36.2 29" />
        <path d="M26.5 34.5V23M21.2 28.3L26.5 23L32.2 28.3" />
      </g>
    </Svg>
  );
}

export function CloseX() {
  return (
    <Svg x={595} y={235} w={30} h={30}>
      <path d="M7 7.5L20.5 20.5M20.5 7.5L7 20.5" stroke="#808080" strokeWidth={1.75} />
    </Svg>
  );
}

export function Trash() {
  return (
    <Svg x={575} y={718} w={30} h={30}>
      <g stroke="#5f5f5f" strokeWidth={1.5}>
        <path d="M3.5 9.6H23M10 8.5V6.2H17.2V8.5" />
        <path d="M6.6 9.6L7.6 22A2.5 2.5 0 0 0 10.1 24.3H17.3A2.5 2.5 0 0 0 19.8 22L20.5 9.6" />
        <path d="M11.6 13V20M15.7 13V20" />
      </g>
    </Svg>
  );
}

/** The page outline with the black PDF badge. `x`/`y` offset it from the first file row's glyph. */
export function PdfGlyph({ x, y }: { x: number; y: number }) {
  return (
    <Svg x={170 + x} y={585 + y} w={55} h={65}>
      <g stroke="#d1d2db" strokeWidth={1.875}>
        <path d="M16.5 5H33L47.5 20V48.5A3 3 0 0 1 44.5 51.5H16.5A3 3 0 0 1 13.5 48.5V8A3 3 0 0 1 16.5 5Z" />
        <path d="M33 5V16A4 4 0 0 0 37 20H47.5" />
      </g>
      <rect x={6.8} y={27.45} width={29.7} height={18.75} rx={2.75} fill="#0d0d0d" />
      <text x={10.3} y={41} fill="#ffffff" fontSize={12} fontWeight={700} letterSpacing="-0.03em">
        PDF
      </text>
    </Svg>
  );
}

export function LogoMark() {
  return (
    <Svg x={365} y={925} w={53} h={47}>
      <g fill="#ffffff" stroke="#ffffff" strokeWidth={1}>
        <path d="M17.5 17L21.5 21L17.5 25L13.5 21Z" />
        <path d="M26.2 16.5L30.2 20.5L26.2 24.5L22.2 20.5Z" />
        <path d="M35 17L39 21L35 25L31 21Z" />
        <path d="M26.2 25.5L30.2 29.5L26.2 33.5L22.2 29.5Z" />
      </g>
    </Svg>
  );
}

export function Sparkle() {
  return (
    <Svg x={785} y={235} w={30} h={30}>
      <g fill="#ffffff">
        <path d="M15.5 5.8Q18 13 26 15.5Q18 18 15.5 26Q13 18 5.8 15.5Q13 13 15.5 5.8Z" />
        <path d="M7.5 5Q8.1 7.9 11 8.5Q8.1 9.1 7.5 12Q6.9 9.1 4 8.5Q6.9 7.9 7.5 5Z" />
        <path d="M7.5 19.5Q8.1 22.4 11 23Q8.1 23.6 7.5 26.5Q6.9 23.6 4 23Q6.9 22.4 7.5 19.5Z" />
      </g>
    </Svg>
  );
}

export function ReturnArrow() {
  return (
    <Svg x={1805} y={435} w={30} h={30}>
      <path d="M22.3 8V14Q22.3 19.6 16.8 19.8H10" stroke="#000000" strokeWidth={1.75} />
      <path d="M5.8 19.8L12.4 14.2L11.6 25.6Z" fill="#000000" />
    </Svg>
  );
}

const CLIP = "M24.5 12.6L13.4 23.4C10.5 25.6 7.6 25 6 23C4.6 21 5 18.3 6.5 16.6L16 6.8C18 4.6 21.5 4.3 23 6.2C24.2 8 23.8 10 22.3 11.5L12.4 21.3C11.2 22.2 9.8 22 9.1 21C8.5 20 8.8 18.9 9.6 18L17.8 9.7";

export function AttachmentClip() {
  return (
    <Svg x={700} y={515} w={30} h={30}>
      <path d={CLIP} stroke="#2b2b2b" strokeWidth={1.5} />
    </Svg>
  );
}

export function UseImageIcon() {
  return (
    <Svg x={890} y={515} w={30} h={30}>
      <g stroke="#2b2b2b" strokeWidth={1.5}>
        <rect x={4.6} y={4.8} width={18.8} height={18.4} rx={3.5} />
        <path d="M8.2 17.3H20.4M9.2 17.3L11.9 12.4L13.4 12.6L15.5 9.9L19.6 17.3" />
      </g>
    </Svg>
  );
}

export function SearchGlass() {
  return (
    <Svg x={705} y={632} w={30} h={30}>
      <g stroke="#0f0f0f" strokeWidth={1.75}>
        <circle cx={14.7} cy={14.4} r={8} />
        <path d="M20.6 20.4L25 25" />
      </g>
    </Svg>
  );
}

export function CommandKey() {
  return (
    <Svg x={1105} y={636} w={30} h={24}>
      <path
        d="M9.9 9.5H7.6A2.25 2.25 0 1 1 9.9 7.25V16.2A2.25 2.25 0 1 1 7.6 13.95H16.6A2.25 2.25 0 1 1 14.3 16.2V7.25A2.25 2.25 0 1 1 16.6 9.5Z"
        stroke="#111111"
        strokeWidth={1.3}
      />
    </Svg>
  );
}

export function Chevron({ x, y, w, h, color, stroke }: { x: number; y: number; w: number; h: number; color: string; stroke: number }) {
  return (
    <Svg x={x} y={y} w={w} h={h}>
      <path d={`M0.5 0.5L${w / 2} ${h - 0.5}L${w - 0.5} 0.5`} stroke={color} strokeWidth={stroke} />
    </Svg>
  );
}

export function BoldItalicUnderline() {
  return (
    <Svg x={1385} y={695} w={115} h={35}>
      <g stroke="#111111" strokeWidth={1.6}>
        <path d="M2 8.2H9.8A4 4 0 0 1 9.8 16.2H2ZM2 16.2H10.8A4 4 0 0 1 10.8 24.2H2Z" />
        <path d="M45.8 8H56.6M51.7 8L46.3 24.4" />
        <path d="M40.8 24.4H51.8" strokeWidth={1.9} />
        <path d="M83.2 8V17.2A6.9 6.9 0 0 0 97 17.2V8" />
        <path d="M81.2 25.3H98.6" strokeWidth={1.9} />
      </g>
    </Svg>
  );
}

export function AlignIcons() {
  return (
    <Svg x={1530} y={695} w={120} h={35}>
      <path
        d="M7 10H25.8M7 14.2H21.7M7 18H25.8M7 22H21.7M48.3 10H67.5M51.3 14.2H64.7M48.3 18H67.5M51.3 22H64.7M90 10H109M94.2 14.2H109M90 18H109M94.2 22H109"
        stroke="#1a1a1a"
        strokeWidth={1.7}
        strokeLinecap="butt"
      />
    </Svg>
  );
}

export function ToolbarClip() {
  return (
    <Svg x={1686.3} y={695.6} w={30} h={30}>
      <path d={CLIP} stroke="#111111" strokeWidth={1.6} />
    </Svg>
  );
}

export function ToolbarImage() {
  return (
    <Svg x={1685} y={695} w={85} h={35}>
      <g stroke="#111111" strokeWidth={1.7}>
        <rect x={48.7} y={6.9} width={17.4} height={18.4} rx={3.5} />
        <circle cx={53.7} cy={12.6} r={2} />
        <path d="M51.4 25L60.5 14.8L66 19.6" />
      </g>
    </Svg>
  );
}

/** Lucide's link, the one icon it matches, scaled to the reference's 21.7px. */
export function ToolbarLink() {
  return (
    <svg className={styles.svg} style={{ left: u(1770.33), top: u(697.83), width: u(26), height: u(26) }} viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth={1.57} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function ToolbarMore() {
  return (
    <Svg x={1820} y={700} w={10} h={24}>
      <g fill="#111111">
        <circle cx={4.7} cy={4.2} r={1.9} />
        <circle cx={4.7} cy={11.2} r={1.9} />
        <circle cx={4.7} cy={18} r={1.9} />
      </g>
    </Svg>
  );
}

export function GoogleG() {
  return (
    <Svg x={1458} y={1228} w={32} h={32}>
      <path d="M21.9 8.5A8.6 8.6 0 1 0 24.4 15H16.5" stroke="#000000" strokeWidth={3.4} strokeLinecap="butt" strokeLinejoin="miter" />
    </Svg>
  );
}
