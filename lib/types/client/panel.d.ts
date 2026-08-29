import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
/** Component props: locale seat plus the sidebar's column state. */
export type PointsPanelProps = PropsLocale<'points-checkin'> & {
    /** Whether the sidebar renders wide content (false = 56px rail). */
    wide: boolean;
};
/** The sidebar footer action and its expanding card. */
export declare function PointsPanel(props: PointsPanelProps): React.ReactElement;
