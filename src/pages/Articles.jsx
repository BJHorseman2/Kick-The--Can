import Hero from '../components/Hero';
import Section from '../components/Section';
import ArticleCard from '../components/ArticleCard';

const articles = [
  {
    title: 'Why Young People Are Rational to Fear Marriage',
    excerpt: 'Declining marriage rates among young adults may reflect rational risk assessment, not selfishness. The system must earn their trust.',
    tag: 'Young People',
  },
  {
    title: 'The Missing Marriage Disclosure',
    excerpt: 'Every major financial commitment in American life comes with mandatory disclosure—except the one that may have the largest consequences.',
    tag: 'Disclosure',
  },
  {
    title: 'The Divorce Industry Nobody Warns You About',
    excerpt: 'Hourly billing, adversarial incentives, and escalating costs: how the divorce process can financially devastate the families it is supposed to serve.',
    tag: 'Industry',
  },
  {
    title: 'Why Pro-Marriage Policy Must Include Divorce Reform',
    excerpt: 'You cannot credibly encourage marriage while ignoring the system people will face when marriages fail. Reform is not anti-marriage—it is essential to the pro-marriage position.',
    tag: 'Reform',
  },
  {
    title: 'A Mortgage Has More Disclosure Than a Marriage License',
    excerpt: 'Comparing disclosure requirements across mortgages, surgery, investments, and business partnerships with the almost total absence of marital disclosure.',
    tag: 'Disclosure',
  },
  {
    title: "The 45% Problem: What Marriage Advocates Don't Want to Talk About",
    excerpt: 'When a significant percentage of marriages end in divorce, ignoring the exit system is not pro-marriage—it is negligent.',
    tag: 'Analysis',
  },
  {
    title: 'Family Court Is Now Part of the Fertility Debate',
    excerpt: 'Falling birth rates cannot be separated from the system that governs what happens when families break apart. Fear of divorce suppresses family formation.',
    tag: 'Fertility',
  },
  {
    title: 'Prenups Should Be Normal, Not Suspicious',
    excerpt: 'A prenuptial agreement is not a prediction of failure. It is a tool for mutual understanding, clarity, and protection—and it should be as normal as a will.',
    tag: 'Prenups',
  },
  {
    title: 'If Government Wants More Babies, It Needs to Fix Divorce',
    excerpt: 'Pronatalist policy that ignores the divorce system is incomplete. Young people will not confidently have children when the system for dissolving families is opaque and punitive.',
    tag: 'Policy',
  },
  {
    title: 'The Case for Informed Marriage',
    excerpt: 'Informed consent is a principle applied throughout medicine, finance, and business. It is time to apply it to the most consequential contract most people will ever sign.',
    tag: 'Foundation',
  },
];

export default function Articles() {
  return (
    <>
      <Hero
        title="Articles & Essays"
        subtitle="Research, analysis, and argument on marriage disclosure, family-court reform, and the systems that shape American family formation."
      />

      <Section bg="white">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {articles.map((article, i) => (
            <ArticleCard key={i} {...article} />
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-navy-400 text-sm italic">
            Full articles coming soon. Subscribe to our newsletter to be notified when new content is published.
          </p>
        </div>
      </Section>
    </>
  );
}
