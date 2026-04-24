import { Link } from 'react-router-dom';

export default function ArticleCard({ title, excerpt, tag, to }) {
  return (
    <div className="bg-white border border-navy-100 rounded-xl p-6 hover:shadow-lg hover:border-gold-200 transition-all duration-200 flex flex-col">
      {tag && (
        <span className="inline-block self-start text-xs font-semibold uppercase tracking-wider text-gold-600 bg-gold-50 px-3 py-1 rounded-full mb-4">
          {tag}
        </span>
      )}
      <h3 className="font-serif text-lg font-bold text-navy-900 mb-3 leading-snug">{title}</h3>
      {excerpt && (
        <p className="text-navy-600 text-sm leading-relaxed mb-4 flex-1">{excerpt}</p>
      )}
      {to ? (
        <Link to={to} className="text-navy-700 font-semibold text-sm hover:text-gold-600 transition-colors no-underline inline-flex items-center gap-1">
          Read more
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ) : (
        <span className="text-navy-400 text-sm italic">Coming soon</span>
      )}
    </div>
  );
}
