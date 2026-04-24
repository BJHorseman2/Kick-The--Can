export default function IssueCard({ icon, title, description }) {
  return (
    <div className="bg-white border border-navy-100 rounded-xl p-6 hover:shadow-lg hover:border-navy-200 transition-all duration-200">
      {icon && (
        <div className="w-12 h-12 rounded-lg bg-navy-50 flex items-center justify-center mb-4 text-navy-700">
          {icon}
        </div>
      )}
      <h3 className="font-serif text-lg font-bold text-navy-900 mb-2">{title}</h3>
      <p className="text-navy-600 text-sm leading-relaxed">{description}</p>
    </div>
  );
}
