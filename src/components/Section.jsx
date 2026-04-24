export default function Section({ title, subtitle, children, bg = 'white', id }) {
  const bgClass = {
    white: 'bg-white',
    cream: 'bg-cream',
    navy: 'bg-navy-950 text-white',
    'light-navy': 'bg-navy-50',
  }[bg] || 'bg-white';

  const titleColor = bg === 'navy' ? 'text-white' : 'text-navy-900';
  const subtitleColor = bg === 'navy' ? 'text-navy-200' : 'text-navy-600';

  return (
    <section id={id} className={`py-16 sm:py-24 ${bgClass}`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {title && (
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className={`font-serif text-2xl sm:text-3xl md:text-4xl font-bold ${titleColor} tracking-tight`}>
              {title}
            </h2>
            {subtitle && (
              <p className={`mt-4 text-lg ${subtitleColor} leading-relaxed`}>
                {subtitle}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
