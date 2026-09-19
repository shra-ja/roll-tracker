# Frontend

`main.ts` renders the offline empty state and game selector. `style.css` contains
bundled responsive styling; there are no remote fonts/assets. Tests import the
actual entry point, so startup is included in coverage. Keep future native I/O
behind typed backend commands rather than adding filesystem access here.
