# TownshipGo — mobile experience refresh

The update is intentionally a UI/UX release. It retains the existing pedestrian datasets, routing and walking profiles, weather providers, privacy model, report-to-repair workflow and pilot selection. No field verification is created by the visual redesign.

## Design intent and references

- [Erik D. Kennedy, 7 Rules for Creating Gorgeous UI](https://medium.com/@erikdkennedy/7-rules-for-creating-gorgeous-ui-part-1-559d4e805cda): use tonal hierarchy, purposeful accent colours, consistent typography, whitespace and subtle elevation. The new original palette is wine, ivory, neutral ink and restrained green. Status is conveyed with labels and icons as well as colour.
- [UI/UX Design — Function Beyond Aesthetics](https://dev.to/up_min_sparcs/uiux-design-function-beyond-aesthetics-a-beginners-walkthrough-2b72): redesign around what people want to accomplish, not the number of available features. The start/destination controls appear together, and nearby places, errands, local guides and transit are direct entry points.
- [UX Design Institute, UX design principles (2026)](https://www.uxdesigninstitute.com/blog/ux-design-principles-2026/): prioritize hierarchy, consistency, context, accessible interaction, user control and usability. These are applied to the map, route decisions, report dialogs, profile and operator workspace. The pilot still needs feedback and task testing with real residents and people with mobility needs.

## Interaction changes

- **Explore map:** compact origin and destination inputs, keyboard-operable suggestions, direct task shortcuts and forecast access.
- **Map panel:** a compact peek, half-screen panel, and explicitly selectable full-screen panel. The main grip opens the peek or minimises either expanded position in a single tap. The arrow keys and drag gesture move through the positions. Map modes remain available with a labelled one-tap 2D/3D switch. Filters and neighbourhood focus are still in Layers. On very small screens with extra-large text, the quick tools are revealed by expanding the panel rather than being clipped. The 3D map shows a loading state until its local map is rendered.
- **Plan:** the compact summary shows the estimated time, distance, mapped cover, relevant condition/weather cues and start action. Expanded content is separated into Routes, Access and Settings. Repeated geometry is grouped for display without discarding any routing option. Choosing another mode still uses the original planner response.
- **Access:** field-check requests, journey readiness, entrance selection, evidence dates, uncertainty and route details are available from the access section even when the page uses a map snapshot.
- **Explore tools:** places and comfort, transit, errands and community guides use focused dialogs. Full facility routing, GPS start selection, walk loops and forecast details remain available.
- **Walk / saved / profile:** the compact walk panel includes the active timer and pause/resume; routine monitoring, saved walks, history and personal profile are retained. Existing privacy and display preferences remain device-local.
- **Operator / verification:** shared visual tokens, less intrusive navigation, clearer headings and comparable metric cards. Existing report records, access review authorization and maintenance simulations are retained. The map in these workspaces uses the available local map snapshot, and unavailable live case counts are not displayed as zero.

## Validation focus

The automated unit tests cover the three panel positions and grouping of identical map paths without hiding distinct entrances/rest facilities or dropping a selected route mode. The normal unit/integration suites, type checking, lint and both server and static Pages builds are used for regression checking. Browser testing uses actual pilot snapshots with synthetic test profiles and device-local test records, not real resident GPS logs.

Review on phone portrait (320 and 390 CSS pixels), tablet and desktop, including larger type/high contrast, English/Bahasa Melayu settings, keyboard search, touch sheet positioning and 2D/3D map restoration. Check all major browse, route, save, report, group, transit, errands and operator flows. Dynamic place names, source records and some existing data messages remain in their original source language.

GitHub Pages still uses dated public map snapshots; shared reports and actual verification require the server version. Weather/feed failures are displayed as unavailable rather than fabricated forecasts.
