import { getBoundingClientRect } from '@documenso/lib/client-only/get-bounding-client-rect';
import { PDF_VIEWER_PAGE_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import type { Field } from '@prisma/client';
import { TooltipArrow } from '@radix-ui/react-tooltip';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../primitives/tooltip';

const tooltipVariants = cva('font-semibold', {
  variants: {
    color: {
      default: 'border-2 fill-white',
      warning: 'border-0 bg-orange-300 fill-orange-300 text-orange-900',
    },
  },
  defaultVariants: {
    color: 'default',
  },
});

interface EnvelopeFieldToolTipProps extends VariantProps<typeof tooltipVariants> {
  children: React.ReactNode;
  className?: string;
  field: Pick<Field, 'id' | 'inserted' | 'fieldMeta' | 'positionX' | 'positionY' | 'width' | 'height' | 'page'>;

  /**
   * Called when the signer presses the tooltip.
   *
   * The tooltip tells the signer to click the field, so it should be one of the
   * things they can click. The field itself is drawn on a canvas and can be
   * only a few millimetres tall on a phone, which leaves the label the larger
   * and more obvious target of the two.
   */
  onActivate?: () => void;
}

/**
 * Renders a tooltip for a given field.
 */
export function EnvelopeFieldToolTip({
  children,
  color,
  className = '',
  field,
  onActivate,
}: EnvelopeFieldToolTipProps) {
  const [coords, setCoords] = useState({
    x: 0,
    y: 0,
    height: 0,
    width: 0,
  });

  const calculateCoords = useCallback(() => {
    const $page = document.querySelector<HTMLElement>(`${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${field.page}"]`);

    if (!$page) {
      return;
    }

    const { height, width } = getBoundingClientRect($page);

    const fieldX = (Number(field.positionX) / 100) * width;
    const fieldY = (Number(field.positionY) / 100) * height;

    const fieldHeight = (Number(field.height) / 100) * height;
    const fieldWidth = (Number(field.width) / 100) * width;

    setCoords({
      x: fieldX,
      y: fieldY,
      height: fieldHeight,
      width: fieldWidth,
    });
  }, [field.height, field.page, field.positionX, field.positionY, field.width]);

  useEffect(() => {
    calculateCoords();
  }, [calculateCoords]);

  useEffect(() => {
    const onResize = () => {
      calculateCoords();
    };

    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [calculateCoords]);

  useEffect(() => {
    const $page = document.querySelector<HTMLElement>(`${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${field.page}"]`);

    if (!$page) {
      return;
    }

    const observer = new ResizeObserver(() => {
      calculateCoords();
    });

    observer.observe($page);

    return () => {
      observer.disconnect();
    };
  }, [calculateCoords, field.page]);

  return (
    <div
      id="field-tooltip"
      // Stays click-through: this sits directly on top of the field, and the
      // field is drawn on a canvas underneath. The label itself is rendered in
      // a portal elsewhere in the page, so it can still be pressed.
      className={cn('pointer-events-none absolute')}
      style={{
        top: `${coords.y}px`,
        left: `${coords.x}px`,
        height: `${coords.height}px`,
        width: `${coords.width}px`,
      }}
    >
      <TooltipProvider>
        <Tooltip delayDuration={0} open={!field.inserted || !field.fieldMeta}>
          <TooltipTrigger className="absolute inset-0 w-full"></TooltipTrigger>

          <TooltipContent
            className={tooltipVariants({
              color,
              className: cn(className, 'z-40', onActivate && 'cursor-pointer select-none'),
            })}
            sideOffset={2}
            onClick={onActivate}
          >
            {children}
            <TooltipArrow />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
