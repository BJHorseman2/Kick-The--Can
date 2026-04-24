import Hero from '../components/Hero';
import Section from '../components/Section';
import Callout from '../components/Callout';
import CTA from '../components/CTA';

const reasons = [
  {
    title: 'Student Debt',
    text: 'Many young adults carry significant student loan balances, making them cautious about taking on the additional financial risks and obligations of marriage.',
  },
  {
    title: 'Housing Costs',
    text: 'High housing costs in many markets make it harder for young couples to establish the financial foundation traditionally associated with marriage and family formation.',
  },
  {
    title: 'Career Instability',
    text: 'The modern economy offers less job security than previous generations experienced. Starting a family amid career uncertainty feels risky to many young people.',
  },
  {
    title: 'Fear of Divorce',
    text: 'Many young adults grew up watching their parents or other families go through divorce. They have seen the emotional and financial damage firsthand.',
  },
  {
    title: 'Fear of Asset Loss',
    text: 'Young people who are building wealth—saving, investing, starting businesses—may fear that marriage exposes those assets to division in a divorce.',
  },
  {
    title: 'Fear of Custody Battles',
    text: 'The prospect of losing daily contact with their children or being drawn into a custody dispute is a powerful deterrent for potential parents.',
  },
  {
    title: 'Fear of Financial Punishment',
    text: 'Some young people worry that earning more, saving more, or being more financially responsible could work against them in a divorce.',
  },
  {
    title: 'Fear of Unequal Domestic Labor',
    text: 'Concerns about inequitable distribution of household and childcare responsibilities—and the career sacrifices that may follow—affect both men and women.',
  },
  {
    title: 'Online Exposure to Divorce Stories',
    text: 'Social media and online forums expose young people to a constant stream of divorce horror stories, custody battles, and financial devastation narratives.',
  },
  {
    title: 'Lack of Trust in Institutions',
    text: 'Declining trust in courts, government, and institutions extends to the family-law system. Young people may doubt that the system will treat them fairly.',
  },
];

export default function YoungPeople() {
  return (
    <>
      <Hero
        title="Young People May Be Rational to Fear Marriage"
        subtitle="Declining marriage rates among young adults are not simply a product of selfishness or immaturity. They may reflect a reasonable response to unclear risk and a system that fails to earn trust."
      />

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <Callout variant="gold">
            "Young people may not be rejecting family. They may be rejecting unclear risk."
          </Callout>

          <div className="mt-8 space-y-4 text-navy-600 leading-relaxed">
            <p>
              When policymakers and cultural commentators lament declining marriage and birth rates, they
              often focus on individual attitudes: young people are too selfish, too career-focused, too
              unwilling to sacrifice.
            </p>
            <p>
              But this framing ignores a simpler explanation: young people are looking at the system and
              making a rational assessment. They see the financial risks. They see the legal complexity.
              They see what can happen when marriages fail. And many conclude that the risk is too high
              or too opaque to take on confidently.
            </p>
            <p>
              If we want more young people to choose marriage and parenthood, we need to make the system
              more transparent, more predictable, and less destructive when things go wrong.
            </p>
          </div>
        </div>
      </Section>

      <Section
        title="Why Young People Hesitate"
        subtitle="These concerns are not hypothetical. They represent real barriers to family formation."
        bg="cream"
      >
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-5">
          {reasons.map((reason, i) => (
            <div key={i} className="bg-white border border-navy-100 rounded-xl p-5 hover:shadow-md transition-shadow">
              <h3 className="font-serif text-base font-bold text-navy-900 mb-2">{reason.title}</h3>
              <p className="text-navy-600 text-sm leading-relaxed">{reason.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <div className="bg-navy-950 rounded-2xl p-8 sm:p-12 text-center">
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white mb-6">
              The Right Response Is Not Scolding
            </h2>
            <p className="text-navy-200 text-lg leading-relaxed mb-6">
              Telling young people they are wrong to be cautious will not change their behavior. Showing them
              a system that is transparent, fair, and predictable might.
            </p>
            <p className="text-navy-100 text-xl font-serif font-bold">
              "Marriage should be easier to understand before entering and less financially destructive if it fails."
            </p>
          </div>
        </div>
      </Section>

      <Section bg="cream">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-navy-400 text-sm italic">
            Sources coming soon. This section will include citations to research on marriage attitudes,
            generational economic trends, and family-formation patterns among young adults.
          </p>
        </div>
      </Section>

      <CTA
        title="What Reforms Would Help?"
        subtitle="From premarital disclosure to family-court reform, concrete changes could rebuild trust in the system."
        buttonLabel="Explore Reform Ideas"
        buttonTo="/reform"
      />
    </>
  );
}
