import Hero from '../components/Hero';
import Section from '../components/Section';
import Callout from '../components/Callout';
import IssueCard from '../components/IssueCard';
import CTA from '../components/CTA';

const industryTopics = [
  {
    title: 'Hourly Billing',
    description: 'Most divorce attorneys bill by the hour. This structure can create a financial incentive to extend proceedings rather than resolve them efficiently.',
  },
  {
    title: 'Retainers',
    description: 'Divorce often requires upfront retainers of thousands of dollars, which may need to be replenished multiple times during contested cases.',
  },
  {
    title: 'Discovery Fights',
    description: 'Legal discovery—the process of gathering financial information—can become a battle in itself, generating fees for subpoenas, depositions, and document production.',
  },
  {
    title: 'Custody Evaluations',
    description: 'Court-ordered custody evaluations can cost thousands of dollars and may take months to complete, prolonging uncertainty for parents and children.',
  },
  {
    title: 'Forensic Accountants',
    description: 'Complex assets, business ownership, or suspected hidden income may require forensic accounting, adding significant expense to the process.',
  },
  {
    title: 'Expert Witnesses',
    description: 'Vocational experts, appraisers, child psychologists, and other experts may be hired by one or both sides, each adding to the cost.',
  },
  {
    title: 'Motions and Hearings',
    description: 'Each motion filed, each hearing attended, and each court appearance generates attorney fees. Contested cases can involve dozens of these.',
  },
  {
    title: 'Delays',
    description: 'Court backlogs, continuances, and scheduling conflicts can extend divorce proceedings for months or years. During this time, both parties continue paying legal fees.',
  },
  {
    title: 'Settlement Pressure',
    description: 'The mounting cost of litigation can pressure one or both parties to accept unfavorable settlements simply to stop the financial bleeding.',
  },
  {
    title: 'Power Imbalances',
    description: 'When one spouse controls significantly more income or assets, they may be able to outspend the other in legal proceedings, creating an unequal playing field.',
  },
];

export default function DivorceIndustry() {
  return (
    <>
      <Hero
        title="The Divorce Industry Nobody Warns Couples About"
        subtitle="Divorce is sometimes necessary. But the system through which many divorces are processed can be unnecessarily expensive, adversarial, and damaging to the families it is supposed to serve."
      />

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <div className="bg-navy-50 border border-navy-100 rounded-xl p-6 sm:p-8 mb-10">
            <h3 className="font-serif text-lg font-bold text-navy-900 mb-3">A Note on Fairness</h3>
            <p className="text-navy-600 leading-relaxed mb-3">
              Not all divorce attorneys are part of the problem. Many family-law professionals work with
              integrity, advocate effectively for their clients, and genuinely try to minimize harm.
            </p>
            <p className="text-navy-600 leading-relaxed">
              The issue is not individual attorneys—it is a <em>system</em> built on structures that can reward
              escalation, delay, and conflict, even when the family would benefit from speed, clarity, mediation,
              and predictable rules.
            </p>
          </div>

          <Callout variant="dark">
            "The system often rewards escalation, delay, and conflict—even when many families would benefit
            from speed, clarity, mediation, and predictable rules."
          </Callout>
        </div>
      </Section>

      <Section
        title="How the System Can Harm Families"
        bg="cream"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {industryTopics.map((topic, i) => (
            <IssueCard key={i} title={topic.title} description={topic.description} />
          ))}
        </div>
      </Section>

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-navy-900 mb-6 text-center">
            Why Middle-Class Families Are Most Vulnerable
          </h2>

          <div className="space-y-4 text-navy-600 leading-relaxed">
            <p>
              Wealthy families can afford extended litigation. Low-income families may qualify for legal aid
              or simplified processes. Middle-class families often fall in the gap: enough assets to fight over,
              not enough to afford the fight without serious financial damage.
            </p>
            <p>
              A contested divorce can consume savings, force the sale of the family home, deplete retirement
              accounts, and leave both parties in significantly worse financial positions than before the
              proceedings began.
            </p>
            <p>
              The irony is stark: a system designed to divide assets fairly can, through the cost of the
              process itself, destroy much of the value it is trying to divide.
            </p>
          </div>

          <div className="mt-10">
            <Callout variant="gold">
              "Some divorces are necessary. But necessary divorce should not mean financial warfare."
            </Callout>
          </div>
        </div>
      </Section>

      <Section bg="cream">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-navy-400 text-sm italic">
            Sources coming soon. This section will include citations to published research on divorce costs,
            attorney billing practices, and family-court proceedings data.
          </p>
        </div>
      </Section>

      <CTA
        title="What Reforms Could Change This?"
        subtitle="From mandatory mediation to transparent fee reporting, there are concrete steps that could reduce the harm."
        buttonLabel="Explore Reform Ideas"
        buttonTo="/reform"
      />
    </>
  );
}
