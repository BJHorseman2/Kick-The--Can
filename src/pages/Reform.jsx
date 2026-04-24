import Hero from '../components/Hero';
import Section from '../components/Section';
import Callout from '../components/Callout';
import CTA from '../components/CTA';

const reforms = [
  {
    title: 'Mandatory Premarital Legal Disclosure',
    description: 'Require that every couple applying for a marriage license receive a plain-English disclosure of the legal and financial consequences of marriage and divorce in their state.',
    category: 'Before Marriage',
  },
  {
    title: 'Optional Premarital Education Incentives',
    description: 'Offer reduced marriage license fees, tax credits, or other incentives for couples who complete premarital education covering legal, financial, and relationship topics.',
    category: 'Before Marriage',
  },
  {
    title: 'State-Specific Plain-English Marriage Guides',
    description: 'Each state should publish a clear, accessible guide explaining how marriage affects property, debt, support, custody, and retirement in that jurisdiction.',
    category: 'Before Marriage',
  },
  {
    title: 'Normalize Prenups and Postnups',
    description: 'Prenuptial and postnuptial agreements should be normalized as tools of clarity and mutual protection, not treated as signs of distrust or impending divorce.',
    category: 'Before Marriage',
  },
  {
    title: 'Default Mediation Before Litigation',
    description: 'Require or strongly incentivize mediation as a first step in divorce proceedings. Litigation should be available when needed, but not the default path.',
    category: 'During Divorce',
  },
  {
    title: 'Transparent Attorney-Fee Reporting',
    description: 'Require divorce attorneys to provide detailed, standardized fee disclosures at the outset and regular billing summaries throughout proceedings.',
    category: 'During Divorce',
  },
  {
    title: 'Early Neutral Financial Evaluation',
    description: 'Offer early neutral evaluation of financial issues so both parties understand the likely range of outcomes before spending large amounts on litigation.',
    category: 'During Divorce',
  },
  {
    title: 'Faster Temporary Support Rules',
    description: 'Establish clearer, faster processes for temporary support and custody arrangements so families are not left in limbo during extended proceedings.',
    category: 'During Divorce',
  },
  {
    title: 'Predictable Custody Frameworks',
    description: 'Move toward more predictable, guideline-based custody frameworks that reduce litigation over custody and provide clearer expectations for both parents.',
    category: 'During Divorce',
  },
  {
    title: 'Fee-Shifting for Bad-Faith Litigation',
    description: 'Allow courts to shift attorney fees to parties who engage in bad-faith litigation tactics, including unnecessary delays, frivolous motions, and discovery abuse.',
    category: 'System Reform',
  },
  {
    title: 'Family-Court Data Transparency',
    description: 'Publish anonymized data on family-court outcomes, including average duration, costs, and outcomes by case type, so the public can evaluate system performance.',
    category: 'System Reform',
  },
  {
    title: 'Public Statistics by County, Judge, Duration, and Cost',
    description: 'Make court-level data available so that families, policymakers, and researchers can identify patterns, bottlenecks, and disparities in the system.',
    category: 'System Reform',
  },
  {
    title: 'Online Divorce Pathways for Low-Conflict Cases',
    description: 'Create streamlined, low-cost online divorce options for uncontested cases, reducing the need for expensive legal representation when both parties agree.',
    category: 'System Reform',
  },
  {
    title: 'Middle-Income Legal Support',
    description: 'Expand access to affordable legal services for middle-income families who earn too much for legal aid but cannot afford full private representation.',
    category: 'System Reform',
  },
];

const categories = ['Before Marriage', 'During Divorce', 'System Reform'];

export default function Reform() {
  return (
    <>
      <Hero
        title="Reforms for Informed Marriage and Less Destructive Divorce"
        subtitle="If America wants stronger families, it needs to fix the system that is driving people away from family formation. These are concrete, achievable reforms."
      />

      <Section bg="white">
        <div className="max-w-3xl mx-auto text-center">
          <Callout variant="dark">
            "Pro-marriage policy must include divorce reform."
          </Callout>
          <p className="mt-6 text-navy-600 leading-relaxed text-lg">
            You cannot credibly encourage people to marry while ignoring the system they will face if the
            marriage fails. Informed marriage and lower-conflict divorce are not contradictory goals—they
            are complementary.
          </p>
        </div>
      </Section>

      {categories.map((cat) => (
        <Section
          key={cat}
          title={cat}
          bg={cat === 'During Divorce' ? 'cream' : 'white'}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {reforms
              .filter((r) => r.category === cat)
              .map((reform, i) => (
                <div key={i} className="bg-white border border-navy-100 rounded-xl p-6 hover:shadow-lg hover:border-gold-200 transition-all">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gold-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-gold-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-serif text-base font-bold text-navy-900 mb-2">{reform.title}</h3>
                      <p className="text-navy-600 text-sm leading-relaxed">{reform.description}</p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </Section>
      ))}

      <Section bg="navy">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white mb-6">
            The Core Principle
          </h2>
          <p className="text-xl text-navy-100 font-serif leading-relaxed">
            "Informed marriage. Lower-conflict divorce. Stronger families."
          </p>
          <div className="mt-6 w-16 h-0.5 bg-gold-400 mx-auto" />
          <p className="mt-6 text-navy-200 leading-relaxed">
            These reforms are not anti-marriage. They are pro-transparency, pro-fairness, and
            pro-family. A system that people trust is a system that people will use.
          </p>
        </div>
      </Section>

      <CTA
        title="See What a Marriage Disclosure Could Look Like"
        subtitle="A model disclosure document showing what every couple deserves to know before marriage."
        buttonLabel="View the Model Disclosure"
        buttonTo="/model-disclosure"
        variant="gold"
      />
    </>
  );
}
