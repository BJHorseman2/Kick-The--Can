import { Link } from 'react-router-dom';

export default function CTA({ title, subtitle, buttonLabel, buttonTo, variant = 'navy' }) {
  const bg = variant === 'navy' ? 'bg-navy-950' : 'bg-gold-50';
  const titleColor = variant === 'navy' ? 'text-white' : 'text-navy-900';
  const subtitleColor = variant === 'navy' ? 'text-navy-200' : 'text-navy-600';
  const btnClass = variant === 'navy'
    ? 'bg-gold-400 text-navy-950 hover:bg-gold-300'
    : 'bg-navy-900 text-white hover:bg-navy-800';

  return (
    <section className={`${bg} py-16 sm:py-20`}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <h2 className={`font-serif text-2xl sm:text-3xl font-bold ${titleColor} tracking-tight mb-4`}>
          {title}
        </h2>
        {subtitle && (
          <p className={`text-lg ${subtitleColor} mb-8 leading-relaxed`}>
            {subtitle}
          </p>
        )}
        <Link
          to={buttonTo}
          className={`inline-flex items-center justify-center px-8 py-3.5 font-semibold rounded-lg transition-colors no-underline text-base ${btnClass}`}
        >
          {buttonLabel}
        </Link>
      </div>
    </section>
  );
}
