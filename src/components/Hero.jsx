import { Link } from 'react-router-dom';

export default function Hero({ title, subtitle, primaryCta, secondaryCta, centered = true }) {
  return (
    <section className="relative bg-navy-950 pt-28 pb-16 sm:pt-36 sm:pb-24 overflow-hidden">
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gold-400 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-navy-400 rounded-full blur-3xl" />
      </div>

      <div className={`relative max-w-4xl mx-auto px-4 sm:px-6 ${centered ? 'text-center' : ''}`}>
        <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl lg:text-[3.25rem] font-bold text-white leading-tight tracking-tight">
          {title}
        </h1>

        {subtitle && (
          <p className="mt-6 text-lg sm:text-xl text-navy-200 leading-relaxed max-w-3xl mx-auto">
            {subtitle}
          </p>
        )}

        {(primaryCta || secondaryCta) && (
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            {primaryCta && (
              <Link
                to={primaryCta.to}
                className="inline-flex items-center justify-center px-8 py-3.5 bg-gold-400 text-navy-950 font-semibold rounded-lg hover:bg-gold-300 transition-colors no-underline text-base"
              >
                {primaryCta.label}
              </Link>
            )}
            {secondaryCta && (
              <Link
                to={secondaryCta.to}
                className="inline-flex items-center justify-center px-8 py-3.5 border border-navy-400 text-navy-100 font-medium rounded-lg hover:bg-navy-800 transition-colors no-underline text-base"
              >
                {secondaryCta.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
