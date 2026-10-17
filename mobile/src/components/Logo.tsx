import Svg, { Path } from "react-native-svg";

/** The Wingman mark: two wings meeting, each friend sheltering the other (same paths as assets/brand/icon.svg). */
export function Logo({ size = 64, color = "#FFFFFF" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="140 270 744 510">
      <Path
        fill={color}
        d="M500 760 C 420 690, 300 640, 210 520 C 170 466, 150 400, 158 330 C 210 392, 270 420, 330 432 C 300 400, 282 360, 280 312 C 330 360, 380 382, 430 392 C 410 362, 400 330, 402 290 C 450 352, 492 420, 506 520 Z"
      />
      <Path
        fill={color}
        opacity={0.75}
        d="M524 760 C 604 690, 724 640, 814 520 C 854 466, 874 400, 866 330 C 814 392, 754 420, 694 432 C 724 400, 742 360, 744 312 C 694 360, 644 382, 594 392 C 614 362, 624 330, 622 290 C 574 352, 532 420, 518 520 Z"
      />
    </Svg>
  );
}
