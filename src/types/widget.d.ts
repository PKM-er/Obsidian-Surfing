import { WidgetType } from "@codemirror/view";

interface MathWidget extends WidgetType {
	math: string;
	block: boolean;
}
