interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, icon, disabled }: Props) {
  return (
    <div className="flex items-center justify-between py-1.5">
      {/* Disabled: muted (still readable) label; only the switch itself is faded. */}
      <span className={`flex items-center gap-2 text-[13px] ${disabled ? 'text-muted' : 'text-[#344054]'}`}>
        {icon}
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-brand' : 'bg-[#d0d5dd]'}`}
      >
        <span
          className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  );
}
