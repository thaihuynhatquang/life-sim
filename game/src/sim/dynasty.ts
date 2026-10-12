// Dynasty: when a life ends, play one of the children next. The child's life starts from birth in the
// household the parent had at that moment: same country, the family's living standard then, the
// parent's real age, the other parent, brothers and sisters as they were born in the parent's life.
// What happens to the parent is already known and stays consistent: the played parent dies at the
// same age as in their own life, and their net worth at death becomes the estate the children share.
//
// Persistence across generations comes from the same model as everything else: the family's living
// standard sets education (correlated as strongly as schooling passes from parents to children in that
// country, World Bank GDIM), education and family set adult standing, standing sets income and wealth.
//
// ASSUMPTION: the world stays at today's statistics; later generations are not projected into the future.

import type { World } from '../model/world.ts';
import type { Rng } from '../model/rng.ts';
import { normCdf } from '../model/stats.ts';
import { incomeAt } from '../model/income.ts';
import { createPerson, type Family, type Kin, type Person } from './person.ts';
import { wealthRankAt } from './money.ts';
import { marriage } from './calibrate.ts';
import { EDU_BOOST } from './decisions.ts';

/** Children who can be played next: born, and alive when the parent died. */
export const heirsOf = (p: Person): Kin[] => p.children.filter(k => k.alive);

export function childLife(world: World, parent: Person, child: Kin, rng: Rng): Person {
  const country = world.byId[child.bornIn ?? parent.b.country.c.id] ?? parent.b.country;
  const z = child.familyZ ?? 0, u = normCdf(z);
  const birth = { country, sex: child.sex, wealthPct: u, wealthZ: z, familyIncome: incomeAt(country.income, u) };
  const pa = child.bornAt ?? 25; // the parent's age at this birth
  const gap = marriage(country.c).gap;
  const oa = child.otherAgeAtBirth ?? Math.round(parent.b.sex === 'F' ? pa + gap : Math.max(15, pa - gap));
  const parentDiesAt = parent.age - pa; // the parent died during the year they were this age
  const other = child.other;
  const otherDiesAt = other?.deathAge !== undefined ? other.deathAge - oa : undefined;
  // Brothers and sisters: the parent's other children, with their ages relative to this child.
  const siblings: Kin[] = [];
  for (const s of parent.children) {
    if (s === child) continue;
    const age = pa - (s.bornAt ?? pa);
    if (age > 0 && s.deathAge !== undefined && s.deathAge < age) continue; // died before this child was born
    siblings.push({ sex: s.sex, age, alive: true, bornAt: age < 0 ? -age : undefined, name: s.name,
      diesAt: s.deathAge !== undefined ? s.deathAge - age : undefined });
  }
  const female = parent.b.sex === 'F';
  const family: Family = {
    motherAge: female ? pa : oa, fatherAge: female ? oa : pa,
    motherDiesAt: female ? parentDiesAt : otherDiesAt, fatherDiesAt: female ? otherDiesAt : parentDiesAt,
    motherPlayed: female, fatherPlayed: !female,
    selfName: child.name, province: child.bornProvince, takeover: parentDiesAt,
    motherName: female ? parent.name : child.other?.name, fatherName: female ? child.other?.name : parent.name,
    siblings,
    parentU: parent.money.lastNW !== undefined ? wealthRankAt(country, parent.money.lastNW, parent.age) : undefined,
    parentEduZ: parent.lat.eduZ,
    parentNW: parent.money.lastNW,
    parentSchool: { years: parent.plan.schoolYears, uni: parent.plan.university },
    eduBoost: EDU_BOOST * Math.min(1, (child.eduYears ?? 0) / 12),
    gift: child.gift, giftAge: child.giftAge,
    // A will that names one child leaves everything to that child (if they outlive the parent).
    estateShare: parent.plan.willTo !== undefined && parent.children[parent.plan.willTo]?.alive
      ? (parent.children[parent.plan.willTo] === child ? 1 : 0) : undefined,
    generation: parent.generation + 1,
  };
  return createPerson(birth, rng, world.causes, family);
}
