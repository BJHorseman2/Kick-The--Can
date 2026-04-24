import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/problem', label: 'The Problem' },
  { to: '/legal-contract', label: 'Legal Contract' },
  { to: '/missing-disclosure', label: 'Missing Disclosure' },
  { to: '/divorce-industry', label: 'Divorce Industry' },
  { to: '/young-people', label: 'Young People' },
  { to: '/reform', label: 'Reform Ideas' },
  { to: '/articles', label: 'Articles' },
  { to: '/model-disclosure', label: 'Model Disclosure' },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-navy-950/95 backdrop-blur-md border-b border-navy-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2 no-underline" onClick={() => setOpen(false)}>
            <div className="w-8 h-8 rounded bg-gold-400 flex items-center justify-center">
              <span className="text-navy-950 font-bold text-sm font-serif">M</span>
            </div>
            <span className="text-white font-serif font-bold text-lg hidden sm:inline">
              Marriage Disclosure Project
            </span>
            <span className="text-white font-serif font-bold text-lg sm:hidden">
              MDP
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`px-3 py-2 text-sm rounded-md transition-colors no-underline ${
                  location.pathname === link.to
                    ? 'text-gold-300 bg-navy-800'
                    : 'text-navy-200 hover:text-white hover:bg-navy-800/50'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <button
            onClick={() => setOpen(!open)}
            className="lg:hidden text-navy-200 hover:text-white p-2"
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              {open ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav className="lg:hidden bg-navy-950 border-t border-navy-800 max-h-[80vh] overflow-y-auto">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                className={`block px-3 py-2.5 text-sm rounded-md transition-colors no-underline ${
                  location.pathname === link.to
                    ? 'text-gold-300 bg-navy-800'
                    : 'text-navy-200 hover:text-white hover:bg-navy-800/50'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
