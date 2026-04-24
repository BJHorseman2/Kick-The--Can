import Hero from '../components/Hero';
import Section from '../components/Section';
import Callout from '../components/Callout';
import CTA from '../components/CTA';

const disclosureCategories = [
  'Divorce risk by cohort (age, education, income, prior marriages)',
  'Property division rules in your state',
  'Debt exposure and liability for marital debts',
  'Retirement asset division (401k, pension, IRA)',
  'Spousal support eligibility, duration, and amount factors',
  'Child custody frameworks and decision-making standards',
  'Child support calculations and modification rules',
  'Estimated legal fees for contested vs. uncontested divorce',
  'Mediation vs. litigation options and cost differences',
  'Prenuptial and postnuptial agreement basics',
  'State-specific rules that affect your rights',
  'How parental conflict affects children',
  'Business ownership and valuation in divorce',
  'Inheritance and family money protections',
];

const comparisons = [
  {
    area: 'Mortgage',
    disclosures: [
      'Truth in Lending Act (TILA) disclosures',
      'Good Faith Estimate / Loan Estimate',
      'Closing Disclosure',
      'Three-day cooling-off period',
      'APR and total cost of loan',
    ],
  },
  {
    area: 'Surgery',
    disclosures: [
      'Detailed explanation of the procedure',
      'Known risks and complications',
      'Alternative treatments',
      'Expected outcomes and recovery',
      'Patient signature required',
    ],
  },
  {
    area: 'Investing',
    disclosures: [
      'Prospectus with risk factors',
      'Past performance disclaimers',
      'Fee disclosures',
      'Suitability assessments',
      'Regulatory oversight (SEC, FINRA)',
    ],
  },
  {
    area: 'Business Partnership',
    disclosures: [
      'Operating or partnership agreement',
      'Capital contribution terms',
      'Profit and loss allocation',
      'Exit provisions and buyout terms',
      'Legal counsel for each partner',
    ],
  },
  {
    area: 'Marriage',
    disclosures: [
      'Application form',
      'Government-issued ID',
      'Filing fee',
      'Marriage license',
      'Often no legal or financial education',
    ],
    highlighted: true,
  },
];

export default function MissingDisclosure() {
  return (
    <>
      <Hero
        title="The Missing Marriage Disclosure"
        subtitle="Every major financial and legal commitment in American life comes with mandatory disclosures—except the one that may affect you the most."
      />

      <Section
        title="How Other Major Commitments Handle Disclosure"
        bg="white"
      >
        <div className="max-w-4xl mx-auto space-y-6">
          {comparisons.map((item, i) => (
            <div
              key={i}
              className={`rounded-xl p-6 ${
                item.highlighted
                  ? 'bg-gold-50 border-2 border-gold-300'
                  : 'bg-cream border border-navy-100'
              }`}
            >
              <div className="flex items-center gap-3 mb-4">
                <h3 className={`font-serif text-xl font-bold ${
                  item.highlighted ? 'text-gold-600' : 'text-navy-900'
                }`}>
                  {item.area}
                </h3>
                {item.highlighted && (
                  <span className="text-xs font-semibold uppercase tracking-wider text-gold-600 bg-gold-100 px-2 py-0.5 rounded">
                    The Gap
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {item.disclosures.map((d, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <svg className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      item.highlighted ? 'text-gold-400' : 'text-navy-400'
                    }`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      {item.highlighted && j === item.disclosures.length - 1 ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      )}
                    </svg>
                    <span className={`text-sm ${item.highlighted ? 'text-navy-700' : 'text-navy-600'}`}>
                      {d}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="max-w-3xl mx-auto mt-10">
          <Callout variant="gold">
            "A mortgage has more disclosure than a marriage license."
          </Callout>
        </div>
      </Section>

      <Section
        title="What a Marriage Risk Disclosure Could Include"
        subtitle="If we treated marriage with the same seriousness as other major legal and financial commitments, couples would receive clear information on these topics before signing."
        bg="cream"
      >
        <div className="max-w-3xl mx-auto">
          <div className="bg-white border border-navy-100 rounded-xl overflow-hidden">
            <div className="bg-navy-950 px-6 py-4">
              <h3 className="text-white font-serif text-lg font-bold">Marriage Risk Disclosure — Categories</h3>
              <p className="text-navy-300 text-sm mt-1">Proposed disclosure categories for premarital education</p>
            </div>
            <div className="p-6">
              <ol className="space-y-3">
                {disclosureCategories.map((cat, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-xs font-bold text-navy-400 bg-navy-50 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-navy-700 text-sm leading-relaxed">{cat}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </Section>

      <CTA
        title="View the Model Marriage Disclosure"
        subtitle="See a complete model disclosure with checklists, questions, and practical guidance for couples."
        buttonLabel="View the Model Disclosure"
        buttonTo="/model-disclosure"
      />
    </>
  );
}
