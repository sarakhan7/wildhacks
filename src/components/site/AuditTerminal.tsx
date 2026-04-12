type TerminalLine = {
  label: string;
  value: string;
  valueClassName?: string;
};

interface AuditTerminalProps {
  title?: string;
  lines: TerminalLine[];
  compact?: boolean;
}

export function AuditTerminal({
  title = "Technological Institute · audit complete",
  lines,
  compact = false,
}: AuditTerminalProps) {
  return (
    <div className={`glass-dark w-full ${compact ? "max-w-none p-5" : "max-w-[40rem] p-7"}`}>
      <div className="mb-5 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-red-500/85" />
        <span className="h-3 w-3 rounded-full bg-yellow-500/85" />
        <span className="h-3 w-3 rounded-full bg-green-500/85" />
        <span className="ml-3 font-mono text-[0.76rem] text-white/30">{title}</span>
      </div>

      <div className={`space-y-2 font-mono ${compact ? "text-[0.76rem] leading-7" : "text-[0.9rem] leading-8"}`}>
        {lines.map((line, index) =>
          line.label === "" && line.value === "" ? (
            <div key={`spacer-${index}`} className="h-2" />
          ) : (
            <div key={`${line.label}-${index}`} className="flex gap-4">
              <span className={`${compact ? "min-w-[80px]" : "min-w-[124px]"} text-white/34`}>{line.label}</span>
              <span className={line.valueClassName ?? "text-white/76"}>{line.value}</span>
            </div>
          ),
        )}
        <span className="inline-block h-4 w-2 bg-white/70 cursor-blink" />
      </div>
    </div>
  );
}
