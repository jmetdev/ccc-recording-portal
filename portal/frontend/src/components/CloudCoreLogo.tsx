import {
  Box,
  BoxProps,
  createVarsResolver,
  ElementProps,
  factory,
  Factory,
  getSize,
  StylesApiProps,
  useProps,
  useStyles,
} from '@mantine/core';
import classes from './CloudCoreLogo.module.css';

export type CloudCoreLogoStylesNames = 'root' | 'image';
export type CloudCoreLogoCssVariables = {
  root: '--ccc-logo-h';
};

export interface CloudCoreLogoProps
  extends BoxProps,
    StylesApiProps<CloudCoreLogoFactory>,
    ElementProps<'div', 'children'> {
  /** Logo height in px (width scales). Default 36. */
  height?: number | string;
}

export type CloudCoreLogoFactory = Factory<{
  props: CloudCoreLogoProps;
  ref: HTMLDivElement;
  stylesNames: CloudCoreLogoStylesNames;
  vars: CloudCoreLogoCssVariables;
}>;

const defaultProps = {
  height: 36,
} satisfies Partial<CloudCoreLogoProps>;

const varsResolver = createVarsResolver<CloudCoreLogoFactory>((_theme, { height }) => ({
  root: {
    '--ccc-logo-h': typeof height === 'number' ? `${height}px` : getSize(height),
  },
}));

/** Official CloudCoreCollab wordmark (light background). */
export const CloudCoreLogo = factory<CloudCoreLogoFactory>((_props) => {
  const props = useProps('CloudCoreLogo', defaultProps, _props);
  const { classNames, className, style, styles, unstyled, vars, attributes, height, ...others } =
    props;

  const getStyles = useStyles<CloudCoreLogoFactory>({
    name: 'CloudCoreLogo',
    classes,
    props,
    className,
    style,
    classNames,
    styles,
    unstyled,
    vars,
    attributes,
    varsResolver,
  });

  return (
    <Box {...getStyles('root')} {...others}>
      <img
        {...getStyles('image')}
        src="/cloudcorecollab-logo-light.svg"
        alt="CloudCoreCollab"
        height={typeof height === 'number' ? height : undefined}
      />
    </Box>
  );
});

CloudCoreLogo.displayName = '@cloudcorecollab/CloudCoreLogo';
CloudCoreLogo.classes = classes;
