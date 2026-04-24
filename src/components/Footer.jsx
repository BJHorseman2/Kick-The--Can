import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-navy-950 border-t border-navy-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          <div>
            <Link to="/" className="flex items-center gap-2 no-underline mb-4">
              <div className="w-8 h-8 rounded bg-gold-400 flex items-center justify-center">
                <span className="text-navy-950 font-bold text-sm font-serif">M</span>
              </div>
              <span className="text-white font-serif font-bold text-lg">
                Marriage Disclosure Project
              </span>
            </Link>
            <p className="text-navy-300 text-sm leading-relaxed">
              Informed marriage. Lower-conflict divorce. Stronger families.
            </p>
          </div>

          <div>
            <h4 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Explore</h4>
            <ul className="space-y-2">
              {[
                { to: '/problem', label: 'The Problem' },
                { to: '/legal-contract', label: 'Marriage as Legal Contract' },
                { to: '/missing-disclosure', label: 'The Missing Disclosure' },
                { to: '/reform', label: 'Reform Ideas' },
              ].map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-navy-300 hover:text-gold-300 text-sm transition-colors no-underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Resources</h4>
            <ul className="space-y-2">
              {[
                { to: '/model-disclosure', label: 'Model Disclosure' },
                { to: '/articles', label: 'Articles & Essays' },
                { to: '/young-people', label: 'Young People & Marriage' },
                { to: '/children', label: 'Children & Conflict' },
              ].map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-navy-300 hover:text-gold-300 text-sm transition-colors no-underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-navy-800 pt-8">
          <p className="text-navy-400 text-xs text-center leading-relaxed">
            <strong className="text-navy-300">Disclaimer:</strong> This site provides general educational information, not legal advice.
            No attorney–client relationship is created by using this site. Consult a qualified attorney in your jurisdiction
            for advice about your specific situation.
          </p>
          <p className="text-navy-500 text-xs text-center mt-4">
            &copy; {new Date().getFullYear()} The Marriage Disclosure Project. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
