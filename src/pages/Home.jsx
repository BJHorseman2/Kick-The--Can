import Hero from '../components/Hero';
import Section from '../components/Section';
import IssueCard from '../components/IssueCard';
import Callout from '../components/Callout';
import CTA from '../components/CTA';
import Newsletter from '../components/Newsletter';

const issueCards = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" />
      </svg>
    ),
    title: 'Declining Marriage Rates',
    description: 'Fewer Americans are choosing to marry. Marriage rates have fallen steadily for decades, especially among younger adults.',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
      </svg>
    ),
    title: 'Falling Fertility',
    description: 'Birth rates have dropped to historic lows. Many factors contribute, including economic pressure and uncertainty about family stability.',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
    ),
    title: 'Divorce Risk',
    description: 'A significant percentage of marriages end in divorce. Most couples receive little education about the legal and financial consequences before it happens.',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
      </svg>
    ),
    title: 'Family-Court Costs',
    description: 'Divorce litigation can cost tens of thousands of dollars. Many middle-class families are financially devastated by the process.',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
      </svg>
    ),
    title: 'Attorney Incentives',
    description: 'Hourly billing and adversarial procedures can create incentives that reward conflict, delay, and escalation over resolution.',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    title: 'Children Affected by Conflict',
    description: 'Children in high-conflict divorces can experience lasting emotional, academic, and developmental harm. The system should protect them better.',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
      </svg>
    ),
    title: "Young People's Fear of Marriage",
    description: 'Many young adults are not rejecting family—they are rationally assessing unclear risk. Fear of divorce and its consequences suppresses family formation.',
  },
];

const comparisonItems = [
  { label: 'Mortgage', disclosure: 'Multi-page disclosure documents, cooling-off periods, truth-in-lending statements' },
  { label: 'Surgery', disclosure: 'Informed consent forms detailing risks, alternatives, and expected outcomes' },
  { label: 'Investing', disclosure: 'Risk warnings, prospectuses, fiduciary disclosures, suitability requirements' },
  { label: 'Business Partnership', disclosure: 'Operating agreements, capital contribution terms, exit provisions, legal counsel' },
  { label: 'Marriage', disclosure: 'Often just forms, ID, a fee, and a license—with little explanation of legal consequences' },
];

export default function Home() {
  return (
    <>
      <Hero
        title="Marriage Is the Biggest Contract Most People Sign Without Reading."
        subtitle="America wants stronger families, but gives couples little warning about the legal, financial, and parental consequences of divorce. The Marriage Disclosure Project examines divorce risk, family-court incentives, declining marriage, falling birth rates, and the reforms needed to rebuild trust in family formation."
        primaryCta={{ label: 'Read the Marriage Disclosure', to: '/model-disclosure' }}
        secondaryCta={{ label: 'Explore the Issues', to: '/problem' }}
      />

      <Section bg="cream">
        <div className="max-w-3xl mx-auto text-center">
          <p className="font-serif text-xl sm:text-2xl text-navy-800 leading-relaxed font-medium italic">
            "We are not against marriage. We are against uninformed marriage and destructive divorce."
          </p>
          <div className="mt-6 w-16 h-0.5 bg-gold-400 mx-auto" />
          <p className="mt-6 text-navy-600 leading-relaxed">
            The Marriage Disclosure Project is a public-policy and consumer-protection initiative. We believe
            marriage should be easier to understand before entering and less financially destructive if it fails.
          </p>
        </div>
      </Section>

      <Section
        title="One System, Not Separate Problems"
        subtitle="Declining marriage, falling fertility, divorce risk, and family-court dysfunction are interconnected. Treating them as separate issues misses the bigger picture."
        bg="white"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 xl:gap-8">
          {issueCards.map((card, i) => (
            <IssueCard key={i} {...card} />
          ))}
        </div>
      </Section>

      <Section
        title="The Missing Disclosure"
        bg="light-navy"
      >
        <div className="max-w-3xl mx-auto mb-10">
          <p className="text-navy-600 text-center leading-relaxed">
            People receive detailed disclosures before signing a mortgage, undergoing surgery, making investments,
            or entering a business partnership. Marriage—which can have larger financial consequences than many of
            these combined—often comes with almost no meaningful legal or financial education.
          </p>
        </div>

        <div className="max-w-3xl mx-auto space-y-3">
          {comparisonItems.map((item, i) => (
            <div
              key={i}
              className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-4 rounded-lg ${
                item.label === 'Marriage'
                  ? 'bg-gold-50 border-2 border-gold-300'
                  : 'bg-white border border-navy-100'
              }`}
            >
              <span className={`font-semibold text-sm min-w-[140px] ${
                item.label === 'Marriage' ? 'text-gold-600' : 'text-navy-800'
              }`}>
                {item.label}
              </span>
              <span className={`text-sm ${
                item.label === 'Marriage' ? 'text-navy-700 font-medium' : 'text-navy-500'
              }`}>
                {item.disclosure}
              </span>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <Callout variant="gold">
            "A mortgage has more disclosure than a marriage license."
          </Callout>
        </div>
      </Section>

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <div className="bg-navy-950 rounded-2xl p-8 sm:p-12 text-center">
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white mb-6 leading-snug">
              The Core Question
            </h2>
            <p className="text-xl sm:text-2xl text-navy-100 leading-relaxed font-serif">
              "Why would young people confidently enter marriage and parenthood when the legal and financial
              exit system is so opaque, expensive, and adversarial?"
            </p>
            <div className="mt-8 w-16 h-0.5 bg-gold-400 mx-auto" />
          </div>
        </div>
      </Section>

      <Newsletter />

      <CTA
        title="Read the Model Marriage Disclosure"
        subtitle="See what a meaningful premarital disclosure could look like—and why every couple deserves one."
        buttonLabel="View the Disclosure"
        buttonTo="/model-disclosure"
        variant="gold"
      />
    </>
  );
}
