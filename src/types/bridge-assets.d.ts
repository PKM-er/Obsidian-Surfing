// "bridge-assets" is a virtual module of the bundler (see src/extensions). The
// extensions folder declares it for its own type check; this is the same
// declaration for the whole-project check, which follows imports into it.
declare module 'bridge-assets' {
	const files: Record<string, string>;
	export default files;
}
