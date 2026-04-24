import Hero from '../components/Hero';
import Section from '../components/Section';
import Callout from '../components/Callout';
import CTA from '../components/CTA';

const legalTopics = [
  {
    title: 'Marital Property',
    text: 'In many states, income earned and assets acquired during the marriage may be considered marital or community property, regardless of which spouse earned the income. The rules vary significantly by state.',
  },
  {
    title: 'Separate Property',
    text: 'Property owned before marriage, inheritances, and gifts may be considered separate property—but can become marital property if commingled with joint assets. The distinction is often more complex than couples expect.',
  },
  {
    title: 'Debt',
    text: 'Debts incurred during marriage may be divided between spouses in a divorce, even if only one spouse incurred the debt. This can include credit cards, loans, mortgages, and business debts.',
  },
  {
    title: 'Retirement Accounts',
    text: 'Retirement savings accumulated during the marriage—including 401(k)s, pensions, and IRAs—are typically considered marital property and may be divided. This often represents one of the largest marital assets.',
  },
  {
    title: 'Business Ownership',
    text: 'If either spouse owns a business, the growth in value during the marriage may be subject to division. Business valuation in divorce can be complex, contentious, and expensive.',
  },
  {
    title: 'Inheritance and Family Money',
    text: 'Inheritances are often separate property, but can become marital property if deposited into joint accounts or used for marital expenses. Estate planning and marital property law intersect in complex ways.',
  },
  {
    title: 'Spousal Support (Alimony)',
    text: 'Courts may order one spouse to pay support to the other during or after divorce. The amount and duration depend on factors like income disparity, marriage length, and each spouse\'s earning capacity.',
  },
  {
    title: 'Child Support',
    text: 'Both parents have a legal obligation to support their children financially. Child support calculations vary by state and consider factors including income, parenting time, and the child\'s needs.',
  },
  {
    title: 'Custody and Parenting Time',
    text: 'Custody arrangements determine where children live and how major decisions are made. Custody disputes can be among the most emotionally and financially costly aspects of divorce.',
  },
  {
    title: 'The Family Home',
    text: 'The marital home is often a couple\'s largest asset. Decisions about who keeps the home, whether it must be sold, and how equity is divided can be among the most consequential financial issues in a divorce.',
  },
  {
    title: 'Legal Fees',
    text: 'Divorce attorney fees typically range from several thousand to tens of thousands of dollars or more. Contested divorces with custody disputes, business valuation, or complex assets can cost significantly more.',
  },
  {
    title: 'When One Spouse Earns More',
    text: 'Income disparities can significantly affect divorce outcomes. The higher-earning spouse may face support obligations, while the lower-earning spouse may face pressure to become self-supporting quickly.',
  },
  {
    title: 'When One Spouse Leaves the Workforce',
    text: 'A spouse who leaves the workforce to raise children may face reduced earning capacity, career gaps, and lower retirement savings. These sacrifices have long-term financial consequences that divorce may only partially address.',
  },
  {
    title: 'Prenups and Postnups',
    text: 'Prenuptial and postnuptial agreements allow couples to define their own terms for property division and support. They cannot address child custody or child support. Both parties should have independent legal counsel.',
  },
];

export default function LegalContract() {
  return (
    <>
      <Hero
        title="Marriage Is Emotional. It Is Also Legal."
        subtitle="Marriage is a deeply personal commitment. It is also a binding legal contract with consequences that most couples never fully understand before signing."
      />

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <p className="text-navy-600 text-lg leading-relaxed mb-6">
            When two people marry, they are entering a legal relationship that governs property rights,
            financial obligations, parental responsibilities, and more. Most of these rules are set by state
            law—not by the couple—and most couples never read them.
          </p>
          <p className="text-navy-600 text-lg leading-relaxed mb-12">
            Below is a plain-English overview of the major legal and financial areas that marriage affects.
            This is educational information, not legal advice. Laws vary by state, and every situation is different.
          </p>

          <div className="space-y-6">
            {legalTopics.map((topic, i) => (
              <div key={i} className="bg-cream rounded-xl p-6 border border-navy-50">
                <h3 className="font-serif text-lg font-bold text-navy-900 mb-2">{topic.title}</h3>
                <p className="text-navy-600 text-[0.95rem] leading-relaxed">{topic.text}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section bg="cream">
        <div className="max-w-3xl mx-auto">
          <Callout variant="dark">
            "Love is not a substitute for legal literacy."
          </Callout>
        </div>
      </Section>

      <Section bg="white">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-navy-400 text-sm italic">
            Disclaimer: This page provides general educational information about legal concepts related to marriage.
            It is not legal advice. Laws vary by state and jurisdiction. Consult a qualified attorney for advice
            about your specific situation.
          </p>
        </div>
      </Section>

      <CTA
        title="See What a Marriage Disclosure Could Look Like"
        subtitle="If mortgages require disclosure, why doesn't marriage?"
        buttonLabel="View the Model Disclosure"
        buttonTo="/model-disclosure"
      />
    </>
  );
}
