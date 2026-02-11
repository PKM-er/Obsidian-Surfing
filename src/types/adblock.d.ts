export interface FilterListEntry {
	name: string;
	url: string;
	enabled: boolean;
}

export interface ElementHidingRules {
	[domain: string]: ElementHidingRule[];
}

export interface ElementHidingRule {
	id: string;
	selector: string;
	created: number;
}
