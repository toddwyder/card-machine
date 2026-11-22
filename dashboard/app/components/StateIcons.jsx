function BaseIcon({ size = 16, className, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function TickIcon({ size = 16, className }) {
  return (
    <BaseIcon size={size} className={className}>
      <path d="M4.5 10.5L8.25 14.25L15.75 6.25" />
    </BaseIcon>
  );
}

export function PlayIcon({ size = 16, className }) {
  return (
    <BaseIcon size={size} className={className}>
      <path d="M6.5 4.75L15.25 10L6.5 15.25V4.75Z" fill="currentColor" stroke="currentColor" />
    </BaseIcon>
  );
}

export function PauseIcon({ size = 16, className }) {
  return (
    <BaseIcon size={size} className={className}>
      <path d="M7.25 4.75V15.25" />
      <path d="M12.75 4.75V15.25" />
    </BaseIcon>
  );
}

export function ReturnArrowIcon({ size = 16, className }) {
  return (
    <BaseIcon size={size} className={className}>
      <path d="M8 5L4.5 8.5L8 12" />
      <path d="M5 8.5H12.25C14.32 8.5 16 10.18 16 12.25C16 14.32 14.32 16 12.25 16H9.5" />
    </BaseIcon>
  );
}

export function StopCrossIcon({ size = 16, className }) {
  return (
    <BaseIcon size={size} className={className}>
      <path d="M5.5 5.5L14.5 14.5" />
      <path d="M14.5 5.5L5.5 14.5" />
    </BaseIcon>
  );
}

export function AlertIcon({ size = 16, className }) {
  return (
    <BaseIcon size={size} className={className}>
      <path d="M10 3.25L17 15.75H3L10 3.25Z" />
      <path d="M10 8V11.25" />
      <circle cx="10" cy="13.6" r="0.6" fill="currentColor" stroke="none" />
    </BaseIcon>
  );
}

export function WaitingIcon({ size = 16, className }) {
  return (
    <BaseIcon size={size} className={className}>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M10 6.5V10L12.5 11.75" />
    </BaseIcon>
  );
}

export function CircleDotIcon({ size = 16, className }) {
  return (
    <BaseIcon size={size} className={className}>
      <circle cx="10" cy="10" r="5.5" />
    </BaseIcon>
  );
}

export function UnknownIcon({ size = 16, className }) {
  return (
    <BaseIcon size={size} className={className}>
      <circle cx="10" cy="10" r="6.75" strokeDasharray="3 2.5" />
      <path d="M7.75 10H12.25" />
    </BaseIcon>
  );
}
