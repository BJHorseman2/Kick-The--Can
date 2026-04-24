import Hero from '../components/Hero';
import Section from '../components/Section';
import Callout from '../components/Callout';
import CTA from '../components/CTA';

export default function Children() {
  return (
    <>
      <Hero
        title="Children Pay for Adult Conflict"
        subtitle="Divorce is sometimes the right decision for a family. But the way divorce is conducted—how much conflict, how long it takes, how it affects stability—matters enormously for children."
      />

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <div className="space-y-6 text-navy-600 leading-relaxed">
            <p className="text-lg">
              This page is not an argument that every divorce is wrong. Some marriages should end. Safety,
              abuse, and the well-being of all family members must be considered.
            </p>
            <p className="text-lg">
              But research consistently shows that it is not divorce itself that causes the most harm to
              children—it is the level of conflict surrounding the divorce. High-conflict divorce can affect
              children emotionally, academically, financially, and developmentally.
            </p>
          </div>
        </div>
      </Section>

      <Section bg="cream">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-navy-900 mb-8 text-center">
            What Children Need During Family Transitions
          </h2>

          <div className="space-y-5">
            {[
              {
                title: 'Stability',
                text: 'Children need consistent routines, living arrangements, and expectations. Extended legal battles and repeated changes in custody arrangements can undermine this stability.',
              },
              {
                title: 'Predictability',
                text: 'When children can anticipate their schedules, their living situations, and their relationships with both parents, they cope better with family changes.',
              },
              {
                title: 'Lower-Conflict Processes',
                text: 'Mediation, collaborative divorce, and settlement-focused processes tend to produce better outcomes for children than adversarial litigation.',
              },
              {
                title: 'Protection from Adult Disputes',
                text: 'Children should not be exposed to arguments between parents, used as messengers, or placed in the position of choosing sides. The system should help prevent this.',
              },
              {
                title: 'Financial Security',
                text: 'When divorce proceedings consume family savings, children are directly affected. Housing instability, reduced educational opportunities, and lower standards of living follow.',
              },
              {
                title: 'Emotional Support',
                text: 'Children going through family transitions benefit from access to counseling, supportive school environments, and adults who prioritize their emotional well-being.',
              },
            ].map((item, i) => (
              <div key={i} className="bg-white border border-navy-100 rounded-xl p-6">
                <h3 className="font-serif text-lg font-bold text-navy-900 mb-2">{item.title}</h3>
                <p className="text-navy-600 text-[0.95rem] leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-navy-900 mb-8 text-center">
            What the System Should Do Better
          </h2>

          <div className="space-y-4 text-navy-600 leading-relaxed">
            <p>
              A family-law system that prioritized children would look different from what many families
              experience today. It would emphasize speed over delay, mediation over litigation,
              predictability over uncertainty, and the needs of children over the adversarial dynamics
              of their parents.
            </p>
            <p>
              Some jurisdictions are making progress. Collaborative divorce, parenting coordinators,
              child-inclusive mediation, and streamlined custody processes are available in some areas.
              But access is uneven, and the adversarial model remains the default in most of the country.
            </p>
          </div>

          <div className="mt-8">
            <Callout variant="gold">
              "The goal should not be to prevent all divorce. It should be to ensure that when divorce
              happens, the process does not inflict more damage than the marriage itself."
            </Callout>
          </div>
        </div>
      </Section>

      <Section bg="navy">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white mb-6">
            Important Context
          </h2>
          <div className="space-y-4 text-navy-200 leading-relaxed">
            <p>
              Safety always comes first. In cases involving domestic violence, abuse, or threats to
              children, protective measures—including restraining orders, supervised visitation, and
              emergency custody—are essential.
            </p>
            <p>
              Nothing on this page should be interpreted as suggesting that abusive spouses should
              receive more access or that victims should be pressured into mediation. Safety
              concerns require a different framework.
            </p>
          </div>
        </div>
      </Section>

      <Section bg="cream">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-navy-400 text-sm italic">
            Sources coming soon. This section will include citations to published research on the
            effects of high-conflict divorce on children.
          </p>
        </div>
      </Section>

      <CTA
        title="Reforms That Protect Children"
        subtitle="Concrete policy changes could reduce conflict, speed resolution, and put children's needs at the center of the process."
        buttonLabel="Explore Reform Ideas"
        buttonTo="/reform"
      />
    </>
  );
}
