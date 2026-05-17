interface WidgetCardProps {
  title: string;
  children: React.ReactNode;
}

export function WidgetCard({ title, children }: WidgetCardProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}
