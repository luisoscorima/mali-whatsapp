import type { ParamMapping } from '../templates/template-definition.util';
import {
  formatTemplateSenderName,
  materializeTemplateSenderName,
  paramMappingUsesSource,
  USER_NAME_PARAM_SOURCE,
} from './contact-template-params.util';

describe('template sender params', () => {
  const mapping: ParamMapping = {
    headerParams: ['static'],
    bodyParams: ['contact.name', USER_NAME_PARAM_SOURCE],
    buttonParams: [USER_NAME_PARAM_SOURCE],
  };

  it('uses the first given name and first surname', () => {
    expect(
      formatTemplateSenderName({
        first_name: 'María Fernanda',
        last_name: 'López García',
      }),
    ).toBe('María López');
  });

  it('materializes sender name without changing other parameter values', () => {
    const result = materializeTemplateSenderName(
      {
        headerParams: ['Cabecera'],
        bodyParams: ['', ''],
        buttonParams: [''],
        headerMediaUrl: '',
      },
      mapping,
      'María López',
    );

    expect(result).toEqual({
      headerParams: ['Cabecera'],
      bodyParams: ['', 'María López'],
      buttonParams: ['María López'],
      headerMediaUrl: '',
    });
    expect(paramMappingUsesSource(mapping, USER_NAME_PARAM_SOURCE)).toBe(true);
  });
});
