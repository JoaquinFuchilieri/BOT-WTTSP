// Universal Lucide Outline Icon Helper
(function(global) {
    function getLucideSvg(iconName, size = 16, extraClass = '') {
        if (!iconName) return '';
        // Lucide camelCase name: e.g. 'building-2' -> 'Building2', 'play' -> 'Play', 'bar-chart-2' -> 'BarChart2'
        const pascal = iconName.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
        
        if (global.lucide) {
            const iconDef = global.lucide[pascal] || global.lucide[iconName];
            if (iconDef && global.lucide.createElement) {
                const svg = global.lucide.createElement(iconDef);
                svg.setAttribute('width', size);
                svg.setAttribute('height', size);
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '1.8');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                svg.classList.add('lucide', `lucide-${iconName}`);
                if (extraClass) {
                    extraClass.split(' ').filter(Boolean).forEach(c => svg.classList.add(c));
                }
                return svg.outerHTML;
            }
        }
        return `<i data-lucide="${iconName}" class="${extraClass}" style="width:${size}px; height:${size}px;"></i>`;
    }

    function refreshIcons() {
        if (global.lucide && global.lucide.createIcons) {
            try {
                global.lucide.createIcons({
                    attrs: {
                        'stroke': 'currentColor',
                        'stroke-width': 1.8,
                        'fill': 'none',
                        'stroke-linecap': 'round',
                        'stroke-linejoin': 'round'
                    }
                });
            } catch (err) {
                console.error('Error refreshing lucide icons:', err);
            }
        }
    }

    global.getLucideSvg = getLucideSvg;
    global.refreshIcons = refreshIcons;

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', refreshIcons);
        } else {
            refreshIcons();
        }
    }
})(window);
