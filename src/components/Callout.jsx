export default function Callout({ children, variant = 'gold' }) {
  const styles = {
    gold: 'bg-gold-50 border-gold-300 text-navy-900',
    navy: 'bg-navy-50 border-navy-300 text-navy-900',
    dark: 'bg-navy-900 border-gold-400 text-white',
  };

  return (
    <blockquote className={`border-l-4 ${styles[variant]} rounded-r-lg p-6 sm:p-8 my-8`}>
      <div className="font-serif text-xl sm:text-2xl font-bold leading-snug">
        {children}
      </div>
    </blockquote>
  );
}
