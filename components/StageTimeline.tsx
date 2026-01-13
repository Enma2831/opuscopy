import clsx from "clsx";

const stages = ["download", "transcribe", "highlights", "render", "ready"] as const;

type Stage = (typeof stages)[number];

export default function StageTimeline({ stage }: { stage: Stage }) {
  const currentIndex = stages.indexOf(stage);
  return (
    <div className="grid gap-3 md:grid-cols-5">
      {stages.map((item, index) => (
        <div
          key={item}
          className={clsx(
            "rounded-2xl border px-4 py-3 text-xs uppercase tracking-[0.25em]",
            index <= currentIndex
              ? "border-neon bg-neon/20 text-white"
              : "border-white/10 bg-white/5 text-white/40"
          )}
        >
          {item}
        </div>
      ))}
    </div>
  );
}
