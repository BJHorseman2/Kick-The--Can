import Hero from '../components/Hero';
import Section from '../components/Section';
import Callout from '../components/Callout';
import CTA from '../components/CTA';

const systemPoints = [
  {
    title: 'Encouragement Without Education',
    text: 'Government and cultural leaders encourage marriage and children—but rarely explain the legal framework couples are entering. Marriage is promoted as a personal milestone, while the complex legal contract underneath goes largely undiscussed.',
  },
  {
    title: 'Entering Blind',
    text: 'Most couples enter marriage with little understanding of how property will be divided, how support obligations work, what happens to retirement accounts, or how custody decisions are made if the marriage ends.',
  },
  {
    title: 'The Financial Reality of Divorce',
    text: 'Divorce can involve property division, custody disputes, spousal support obligations, retirement account division, business valuation, debt allocation, and substantial legal fees. For many families, the financial damage can take years or decades to recover from.',
  },
  {
    title: 'Incentives That Reward Conflict',
    text: 'Family-law systems built on hourly billing and adversarial procedures can create incentives that reward conflict, delay, and escalation. When both sides hire attorneys paid by the hour, the process itself can become a cost center that harms the family it is supposed to serve.',
  },
  {
    title: 'Rational Hesitation',
    text: 'Young people who delay or avoid marriage may not be selfish or immature. They may be making rational calculations about unclear risk, financial exposure, and a legal system they do not trust. Dismissing their concerns will not increase marriage rates.',
  },
];

export default function Problem() {
  return (
    <>
      <Hero
        title="The Family Formation System Is Broken"
        subtitle="America encourages marriage and children but gives couples little information about the legal and financial system they are entering—and routes many divorces through an expensive, adversarial process."
      />

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <p className="text-navy-600 text-lg leading-relaxed mb-8">
            Declining marriage rates, falling fertility, divorce risk, family-court costs, and young people's fear
            of commitment are usually discussed as separate problems. They are not. They are symptoms of a single
            broken system—one that promotes family formation without transparency and handles family dissolution
            through conflict.
          </p>

          <div className="space-y-8">
            {systemPoints.map((point, i) => (
              <div key={i} className="border-l-2 border-navy-200 pl-6">
                <h3 className="font-serif text-xl font-bold text-navy-900 mb-2">{point.title}</h3>
                <p className="text-navy-600 leading-relaxed">{point.text}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section bg="cream">
        <div className="max-w-3xl mx-auto">
          <Callout variant="gold">
            "Young people may not be rejecting family. They may be rejecting unclear risk."
          </Callout>

          <div className="mt-8 bg-white border border-navy-100 rounded-xl p-6 sm:p-8">
            <h3 className="font-serif text-xl font-bold text-navy-900 mb-4">A Note on Balance</h3>
            <p className="text-navy-600 leading-relaxed mb-4">
              This is not an anti-marriage argument. It is not an anti-lawyer argument. It is not an argument
              aimed at one gender or one political perspective.
            </p>
            <p className="text-navy-600 leading-relaxed mb-4">
              Many attorneys serve their clients with integrity. Many marriages thrive. Many divorces are handled
              fairly.
            </p>
            <p className="text-navy-600 leading-relaxed">
              But the system as a whole—the lack of premarital education, the opacity of family law, the financial
              incentives embedded in adversarial litigation—deserves scrutiny. If we want more marriages and more
              children, we need to fix the system people are afraid of.
            </p>
          </div>
        </div>
      </Section>

      <Section bg="white">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-navy-400 text-sm italic">
            Sources coming soon. This section will include citations to published research on marriage rates,
            divorce statistics, family-court costs, and fertility trends.
          </p>
        </div>
      </Section>

      <CTA
        title="Understand Marriage as a Legal Contract"
        subtitle="Before you can fix the system, you need to understand what marriage actually means in legal terms."
        buttonLabel="Read: Marriage Is Legal"
        buttonTo="/legal-contract"
      />
    </>
  );
}
