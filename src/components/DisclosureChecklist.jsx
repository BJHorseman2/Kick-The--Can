export default function DisclosureChecklist({ title, items }) {
  return (
    <div className="bg-white border border-navy-100 rounded-xl p-6 sm:p-8">
      <h3 className="font-serif text-xl font-bold text-navy-900 mb-5 pb-3 border-b border-navy-100">
        {title}
      </h3>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <div className="mt-0.5 w-5 h-5 rounded border-2 border-navy-300 flex-shrink-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-sm bg-navy-300" />
            </div>
            <span className="text-navy-700 text-sm leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
