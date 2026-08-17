import { FieldType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { canFieldBeActivatedFromTooltip } from './fields';

describe('canFieldBeActivatedFromTooltip', () => {
  it('allows the field types that are a single action', () => {
    const singleAction = [
      FieldType.SIGNATURE,
      FieldType.FREE_SIGNATURE,
      FieldType.INITIALS,
      FieldType.NAME,
      FieldType.EMAIL,
      FieldType.DATE,
      FieldType.TEXT,
      FieldType.NUMBER,
      FieldType.DROPDOWN,
    ];

    for (const type of singleAction) {
      expect(canFieldBeActivatedFromTooltip(type)).toBe(true);
    }
  });

  it('leaves checkboxes and radio groups to be filled in on the field', () => {
    // These need to know which option was pressed, and a label sitting above
    // the field cannot say.
    expect(canFieldBeActivatedFromTooltip(FieldType.CHECKBOX)).toBe(false);
    expect(canFieldBeActivatedFromTooltip(FieldType.RADIO)).toBe(false);
  });

  it('covers every field type', () => {
    // A new field type should be a deliberate decision, not a default.
    for (const type of Object.values(FieldType)) {
      expect(typeof canFieldBeActivatedFromTooltip(type)).toBe('boolean');
    }
  });
});
