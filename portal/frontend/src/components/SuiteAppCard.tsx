import {
  Badge,
  Box,
  BoxProps,
  createVarsResolver,
  factory,
  Factory,
  getRadius,
  Group,
  MantineRadius,
  Stack,
  StylesApiProps,
  Text,
  useProps,
  useStyles,
} from '@mantine/core';
import { IconArrowUpRight } from '@tabler/icons-react';
import classes from './SuiteAppCard.module.css';

export type SuiteAppCardStylesNames =
  | 'root'
  | 'index'
  | 'title'
  | 'description'
  | 'meta'
  | 'arrow';

export type SuiteAppCardVariant = 'active' | 'disabled';

export type SuiteAppCardCssVariables = {
  root: '--suite-card-radius';
};

export interface SuiteAppCardProps extends BoxProps, StylesApiProps<SuiteAppCardFactory> {
  index: string;
  title: string;
  description: string;
  href?: string;
  licensed?: boolean;
  meta?: string;
  radius?: MantineRadius;
}

export type SuiteAppCardFactory = Factory<{
  props: SuiteAppCardProps;
  ref: HTMLDivElement;
  stylesNames: SuiteAppCardStylesNames;
  vars: SuiteAppCardCssVariables;
  variant: SuiteAppCardVariant;
}>;

const defaultProps = {
  licensed: true,
  radius: 'md',
} satisfies Partial<SuiteAppCardProps>;

const varsResolver = createVarsResolver<SuiteAppCardFactory>((_theme, { radius }) => ({
  root: { '--suite-card-radius': getRadius(radius) },
}));

/** Product entry card — matches marketing suite section rhythm. */
export const SuiteAppCard = factory<SuiteAppCardFactory>((_props) => {
  const props = useProps('SuiteAppCard', defaultProps, _props);
  const {
    classNames,
    className,
    style,
    styles,
    unstyled,
    vars,
    attributes,
    variant,
    index,
    title,
    description,
    href,
    licensed = true,
    meta,
    radius,
    ...others
  } = props;

  const resolvedVariant: SuiteAppCardVariant =
    (variant as SuiteAppCardVariant | undefined) === 'active' ||
    (variant as SuiteAppCardVariant | undefined) === 'disabled'
      ? (variant as SuiteAppCardVariant)
      : licensed
        ? 'active'
        : 'disabled';

  const getStyles = useStyles<SuiteAppCardFactory>({
    name: 'SuiteAppCard',
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

  const content = (
    <>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="md">
        <Text {...getStyles('index')}>{index}</Text>
        {licensed ? (
          <IconArrowUpRight size={18} stroke={1.75} className={getStyles('arrow').className} />
        ) : (
          <Badge size="sm" variant="light" color="gray">
            Not licensed
          </Badge>
        )}
      </Group>
      <Stack gap={8}>
        <Text {...getStyles('title')}>{title}</Text>
        <Text {...getStyles('description')}>{description}</Text>
        {meta && <Text {...getStyles('meta')}>{meta}</Text>}
      </Stack>
    </>
  );

  if (!licensed || !href) {
    return (
      <Box {...getStyles('root', { variant: resolvedVariant })} data-disabled {...others}>
        {content}
      </Box>
    );
  }

  return (
    <Box
      component="a"
      href={href}
      {...getStyles('root', { variant: resolvedVariant })}
      {...others}
    >
      {content}
    </Box>
  );
});

SuiteAppCard.displayName = '@cloudcorecollab/SuiteAppCard';
SuiteAppCard.classes = classes;
