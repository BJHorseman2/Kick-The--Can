import Hero from '../components/Hero';
import Section from '../components/Section';
import DisclosureChecklist from '../components/DisclosureChecklist';
import Callout from '../components/Callout';

const checklists = [
  {
    title: 'Questions to Ask Before Marriage',
    items: [
      'What are each partner\'s current debts, assets, and financial obligations?',
      'How will we handle finances during the marriage—joint accounts, separate accounts, or both?',
      'What happens to property and assets each of us brings into the marriage?',
      'If one of us leaves the workforce to raise children, how will we address the career and financial impact?',
      'Have we discussed whether a prenuptial agreement makes sense for our situation?',
      'Do we understand how our state handles property division in divorce?',
      'Have we discussed expectations about children, parenting, and childcare responsibilities?',
      'What are each partner\'s expectations about spousal roles, careers, and lifestyle?',
      'Have we discussed what would happen to the family home if we separated?',
      'Do we both understand how divorce could affect retirement savings?',
    ],
  },
  {
    title: 'Documents to Understand',
    items: [
      'Your state\'s marriage and divorce statutes (available online or from a family-law attorney)',
      'Your state\'s property division framework (community property vs. equitable distribution)',
      'Your state\'s child support guidelines and calculation methods',
      'Your state\'s spousal support (alimony) rules and factors',
      'Your state\'s custody and parenting-time frameworks',
      'Prenuptial agreement requirements in your state',
      'Beneficiary designations on insurance policies, retirement accounts, and financial accounts',
      'Existing wills, trusts, or estate planning documents',
    ],
  },
  {
    title: 'When to Consult a Lawyer',
    items: [
      'Before signing a prenuptial or postnuptial agreement (each party should have independent counsel)',
      'If either partner owns a business or has significant assets',
      'If either partner has children from a prior relationship',
      'If either partner has significant debt',
      'If there is a large income disparity between partners',
      'If either partner expects to receive a significant inheritance',
      'If either partner is a citizen of another country',
      'If either partner has been previously divorced',
    ],
  },
  {
    title: 'When to Consider a Prenup',
    items: [
      'When either partner has significant assets or debts entering the marriage',
      'When either partner owns a business or professional practice',
      'When there is a substantial difference in income or earning capacity',
      'When either partner has children from a prior relationship',
      'When either partner expects a significant inheritance',
      'When either partner is giving up a career or educational opportunity for the marriage',
      'When the partners have different financial philosophies or risk tolerances',
      'When either partner wants clarity and predictability about financial rights and obligations',
    ],
  },
  {
    title: 'How Children Change the Legal and Financial Stakes',
    items: [
      'Child support obligations are determined by state guidelines and can be substantial',
      'Custody disputes can be the most expensive and emotionally damaging part of divorce',
      'Parenting time arrangements affect both parents\' housing, work, and lifestyle choices',
      'A parent who leaves the workforce faces career gaps and reduced earning capacity',
      'Children\'s needs (education, healthcare, activities) create ongoing financial obligations',
      'High-conflict custody disputes can cause lasting harm to children\'s emotional development',
      'Relocation after divorce is often restricted when children are involved',
      'Co-parenting requires ongoing communication and cooperation, even after divorce',
    ],
  },
  {
    title: 'What Divorce Could Affect',
    items: [
      'Division of all marital property (home, savings, investments, vehicles, personal property)',
      'Division of retirement accounts (401k, pension, IRA) accumulated during the marriage',
      'Allocation of marital debts (mortgage, credit cards, loans, taxes)',
      'Spousal support (alimony) obligations, potentially for years or permanently',
      'Child support obligations based on income and parenting time',
      'Custody and parenting time arrangements',
      'Health insurance coverage and costs',
      'Tax filing status and implications',
      'Estate planning and beneficiary designations',
      'Business ownership and valuation',
      'Professional licenses and career assets',
      'Family home (sale, buyout, or continued use)',
      'Legal fees, which can range from thousands to tens of thousands of dollars or more',
    ],
  },
];

export default function ModelDisclosure() {
  return (
    <>
      <Hero
        title="Model Marriage Risk Disclosure"
        subtitle="This is what a meaningful premarital disclosure could look like. It is not legal advice. It is a starting point for the conversation every couple deserves to have."
      />

      <Section bg="cream">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white border border-navy-100 rounded-xl p-6 sm:p-8 mb-8">
            <h3 className="font-serif text-lg font-bold text-navy-900 mb-4">About This Document</h3>
            <div className="space-y-3 text-navy-600 text-[0.95rem] leading-relaxed">
              <p>
                This Model Marriage Risk Disclosure is an educational document designed to illustrate what
                meaningful premarital disclosure could look like. It is not a legal document, does not
                constitute legal advice, and does not create an attorney–client relationship.
              </p>
              <p>
                Laws vary significantly by state and jurisdiction. The information below is general in nature
                and may not apply to your specific situation. Always consult a qualified attorney in your
                jurisdiction for advice about your legal rights and obligations.
              </p>
              <p>
                The goal of this document is to encourage informed decision-making, not to discourage marriage.
                Understanding the legal and financial framework of marriage is an act of responsibility, not pessimism.
              </p>
            </div>
          </div>

          <Callout variant="gold">
            "Informed marriage. Lower-conflict divorce. Stronger families."
          </Callout>
        </div>
      </Section>

      <Section bg="white">
        <div className="max-w-3xl mx-auto space-y-8">
          {checklists.map((checklist, i) => (
            <DisclosureChecklist key={i} title={checklist.title} items={checklist.items} />
          ))}
        </div>
      </Section>

      <Section bg="cream">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-navy-900 mb-6">
            Download This Disclosure
          </h2>
          <p className="text-navy-600 mb-8 leading-relaxed">
            Use this model disclosure as a starting point for your own premarital conversations.
            Share it with your partner, your family, or your attorney.
          </p>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-navy-900 text-white font-semibold rounded-lg hover:bg-navy-800 transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download PDF
          </button>
          <p className="mt-4 text-navy-400 text-sm">
            Opens your browser's print dialog. Choose "Save as PDF" to download.
          </p>
        </div>
      </Section>

      <Section bg="white">
        <div className="max-w-3xl mx-auto">
          <div className="bg-navy-50 border border-navy-100 rounded-xl p-6">
            <p className="text-navy-500 text-sm leading-relaxed text-center">
              <strong className="text-navy-700">Disclaimer:</strong> This Model Marriage Risk Disclosure is
              provided for general educational purposes only. It does not constitute legal advice, and no
              attorney–client relationship is created by reading or using this document. Laws governing
              marriage, divorce, property division, custody, and support vary significantly by state and
              jurisdiction. Consult a qualified attorney for advice about your specific situation.
            </p>
          </div>
        </div>
      </Section>
    </>
  );
}
