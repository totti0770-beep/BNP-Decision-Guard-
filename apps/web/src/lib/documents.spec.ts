import { issuingAuthorityPatch } from './documents';

describe('issuingAuthorityPatch', () => {
  it('sends the value trimmed', () => {
    expect(issuingAuthorityPatch('  Pharmacy & Therapeutics Committee ')).toEqual({
      issuingAuthority: 'Pharmacy & Therapeutics Committee',
    });
  });

  /**
   * The API reads an empty string as "clear" and an absent field as "leave
   * alone". Dropping the key for an empty input would make clearing a wrong
   * value impossible from the screen.
   */
  it('sends an empty string, not nothing, when the field is cleared', () => {
    expect(issuingAuthorityPatch('   ')).toEqual({ issuingAuthority: '' });
  });
});
