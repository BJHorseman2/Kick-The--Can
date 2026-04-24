import { useState } from 'react';

export default function Newsletter() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <section className="bg-navy-900 py-16">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white mb-3">
          Stay Informed
        </h2>
        <p className="text-navy-200 mb-8">
          Get updates on new research, reform proposals, and disclosure resources.
        </p>

        {submitted ? (
          <div className="bg-navy-800 rounded-lg p-6">
            <p className="text-gold-300 font-semibold">Thank you for subscribing.</p>
            <p className="text-navy-300 text-sm mt-1">We'll be in touch with updates.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
            <input
              type="email"
              required
              placeholder="Your email address"
              className="flex-1 px-4 py-3 rounded-lg bg-navy-800 border border-navy-600 text-white placeholder-navy-400 focus:outline-none focus:border-gold-400 transition-colors"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-gold-400 text-navy-950 font-semibold rounded-lg hover:bg-gold-300 transition-colors whitespace-nowrap cursor-pointer"
            >
              Subscribe
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
