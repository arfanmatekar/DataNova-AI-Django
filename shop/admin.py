from django.contrib import admin
from .models import (
    DataNovaProject,
    LearningMilestone,
    Product,
    ProjectDataset,
    Cart,
    Order,
)

admin.site.register(Product)
admin.site.register(Cart)
admin.site.register(Order)
admin.site.register(DataNovaProject)
admin.site.register(ProjectDataset)
admin.site.register(LearningMilestone)
