import React from 'react';
import Label, { LabelProps } from 'Components/Label';
import PerformerGenderIcon from './PerformerGenderIcon';
import styles from './PerformerBadges.module.css';

interface PerformerCredit {
  personName?: string;
  performer?: {
    name?: string;
    gender?: string;
  };
}

interface PerformerBadgesProps {
  credits?: PerformerCredit[] | null;
  names?: string[] | null;
  size?: LabelProps['size'];
}

function PerformerBadges({
  credits,
  names,
  size,
}: Readonly<PerformerBadgesProps>) {
  const performers = new Map<string, { name: string; gender: string }>();

  for (const credit of credits ?? []) {
    const name = credit.personName?.trim() || credit.performer?.name?.trim();

    if (name) {
      performers.set(name.toLocaleLowerCase(), {
        name,
        gender: credit.performer?.gender ?? '',
      });
    }
  }

  // Existing library matches can have names without detailed search credits.
  for (const performerName of names ?? []) {
    const name = performerName?.trim() ?? '';
    const key = name.toLocaleLowerCase();

    if (name && !performers.has(key)) {
      performers.set(key, { name, gender: '' });
    }
  }

  return (
    <>
      {Array.from(performers.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, gender }) => (
          <Label
            key={name.toLocaleLowerCase()}
            className={styles.performer}
            size={size}
            title={name}
          >
            <PerformerGenderIcon gender={gender} size={13} title={null} />
            <span className={styles.name}>{name}</span>
          </Label>
        ))}
    </>
  );
}

export default PerformerBadges;
